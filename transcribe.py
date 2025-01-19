import os
import json
import time
from tqdm import tqdm
from faster_whisper import WhisperModel, BatchedInferencePipeline

def load_progress(progress_file):
    """
    Load the list of completed files from the progress tracker.
    """
    if not os.path.exists(progress_file):
        return set()
    with open(progress_file, "r", encoding="utf-8") as f:
        return set(f.read().splitlines())

def save_progress(progress_file, filename):
    """
    Append a completed filename to the progress tracker.
    """
    with open(progress_file, "a", encoding="utf-8") as f:
        f.write(filename + "\n")

def transcribe_file(
    file_path: str,
    output_folder: str,
    progress_file: str,
    batched_model: BatchedInferencePipeline,
    already_done: set
):
    """
    Transcribe a single .mp3 file if not already done, save the JSON,
    and update the progress file. Returns True if processed, False if skipped.
    """
    mp3_filename = os.path.basename(file_path)

    # Skip if already processed
    if mp3_filename in already_done:
        return False  # Indicate "skipped"

    # Perform transcription
    try:
        segments, info = batched_model.transcribe(
            file_path,
            language="fi",          # Force Finnish
            vad_filter=True,        # Enable VAD
            word_timestamps=True,   # Word-level timestamps
            # you can tune batch_size for your GPU usage, e.g., batch_size=16
            batch_size=16
        )

        # Prepare JSON data
        transcription_data = {
            "file_name": mp3_filename,
            "youtube_id": mp3_filename.split("_")[2],  # Extract video ID
            "words": []
        }

        # Collect word-level timestamps
        for segment in segments:
            for w in segment.words:
                transcription_data["words"].append({
                    "word": w.word.strip(),
                    "start": w.start,
                    "end": w.end
                })

        # Save transcription JSON
        json_name = os.path.splitext(mp3_filename)[0] + ".json"
        json_path = os.path.join(output_folder, json_name)
        with open(json_path, "w", encoding="utf-8") as out_f:
            json.dump(transcription_data, out_f, ensure_ascii=False, indent=2)

        # Update progress/tracker
        save_progress(progress_file, mp3_filename)
        already_done.add(mp3_filename)

        return True  # Indicate "processed"

    except Exception as e:
        # Log error without messing up TQDM's line
        # We'll just print below TQDM bar
        tqdm.write(f"Error processing {mp3_filename}: {e}")
        return False

def transcribe_audio_files(
    input_folder: str,
    output_folder: str = "output",
    progress_file: str = "transcription_progress.txt",
    model_size: str = "large-v3-turbo",
    device: str = "cuda",
    compute_type: str = "float16"
):
    """
    Transcribe all .mp3 files in the input folder using faster-whisper with the specified model.
    Use TQDM for a progress bar, and BatchedInferencePipeline for parallel chunk inference.
    """
    # Load existing progress
    already_done = load_progress(progress_file)

    # Prepare output directory
    os.makedirs(output_folder, exist_ok=True)

    # Gather all .mp3 files
    mp3_files = [os.path.join(input_folder, f) for f in os.listdir(input_folder) if f.endswith(".mp3")]
    mp3_files.sort()
    total_files = len(mp3_files)
    completed_files = len(already_done)

    print(f"Total MP3 files: {total_files}")
    print(f"Already processed: {completed_files}")
    print(f"Remaining: {total_files - completed_files}\n")

    start_time = time.time()
    print(f"Loading Whisper model '{model_size}' on device='{device}' ({compute_type})...")
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    # Use batched inference for speed (parallel chunk processing)
    batched_model = BatchedInferencePipeline(model=model)
    print("Model loaded successfully.\n")

    # Process each file with TQDM progress bar
    with tqdm(total=total_files, desc="Transcribing Files", unit="file") as pbar:
        # We already processed `completed_files`, so set the initial position
        pbar.n = completed_files
        pbar.refresh()

        for file_path in mp3_files:
            mp3_filename = os.path.basename(file_path)

            # If we skip or process, transcribe_file returns True if newly processed, False if skipped
            processed = transcribe_file(
                file_path=file_path,
                output_folder=output_folder,
                progress_file=progress_file,
                batched_model=batched_model,
                already_done=already_done
            )
            if processed:
                # Only increment progress if we actually processed it
                pbar.update(1)

    elapsed = time.time() - start_time
    print(f"\nAll done! Processed {len(already_done)}/{total_files} files in {elapsed:.2f} seconds.")


if __name__ == "__main__":
    # Configuration
    input_folder_path = "./videos"  # Replace with your folder path
    transcribe_audio_files(
        input_folder=input_folder_path,
        output_folder="output",
        progress_file="transcription_progress.txt",
        model_size="large-v3-turbo",
        device="cuda",         # GPU
        compute_type="float16" # Half-precision
    )
