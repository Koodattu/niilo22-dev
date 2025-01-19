import os
import time
import psutil
import pynvml
import threading
from faster_whisper import WhisperModel, BatchedInferencePipeline

def get_ram_usage():
    """
    Retrieves the current RAM usage of the system.

    Returns:
        tuple: Used RAM and total RAM in gigabytes (GB).
    """
    ram = psutil.virtual_memory()
    used_ram = ram.used / (1024 ** 3)  # Convert bytes to GB
    total_ram = ram.total / (1024 ** 3)
    return used_ram, total_ram

def get_vram_usage(handle):
    """
    Retrieves the current VRAM usage of the specified GPU.

    Args:
        handle: NVML device handle.

    Returns:
        tuple: Used VRAM and total VRAM in gigabytes (GB).
    """
    try:
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        used_vram = info.used / (1024 ** 3)  # Convert bytes to GB
        total_vram = info.total / (1024 ** 3)
        return used_vram, total_vram
    except pynvml.NVMLError as error:
        print(f"Error retrieving VRAM usage: {error}")
        return None, None

def print_memory_usage(stage, handle=None):
    """
    Prints the system's RAM and VRAM usage.

    Args:
        stage (str): Description of the current stage for logging.
        handle: NVML device handle (optional).
    """
    used_ram, total_ram = get_ram_usage()
    if handle:
        used_vram, total_vram = get_vram_usage(handle)
        if used_vram is not None:
            print(f"{stage} - RAM Usage: {used_ram:.2f} GB / {total_ram:.2f} GB | VRAM Usage: {used_vram:.2f} GB / {total_vram:.2f} GB")
        else:
            print(f"{stage} - RAM Usage: {used_ram:.2f} GB / {total_ram:.2f} GB | VRAM Usage: N/A")
    else:
        print(f"{stage} - RAM Usage: {used_ram:.2f} GB / {total_ram:.2f} GB")

def transcribe_audio(batched_model, file_path, language="fi"):
    """
    Transcribes an audio file using the provided BatchedInferencePipeline model.

    Args:
        batched_model (BatchedInferencePipeline): The transcription model.
        file_path (str): Path to the audio file.
        language (str): Language code for transcription (default is Finnish 'fi').

    Returns:
        dict: Transcription data containing words and their timestamps.
    """
    segments, info = batched_model.transcribe(
        file_path,
        language=language,       # Set language (e.g., "fi" for Finnish)
        vad_filter=True,         # Enable Voice Activity Detection
        word_timestamps=True,    # Enable word-level timestamps
        batch_size=16             # Adjust based on GPU memory
    )

    transcription_data = {
        "file_name": os.path.basename(file_path),
        "words": []
    }

    for segment in segments:
        for word in segment.words:
            transcription_data["words"].append({
                "word": word.word.strip(),
                "start": word.start,
                "end": word.end
            })

    return transcription_data

def memory_monitor(stop_event, handle, interval=1):
    """
    Monitors and prints RAM and VRAM usage at regular intervals.

    Args:
        stop_event (threading.Event): Event to signal when to stop monitoring.
        handle: NVML device handle.
        interval (int): Time in seconds between measurements.
    """
    while not stop_event.is_set():
        used_ram, total_ram = get_ram_usage()
        used_vram, total_vram = get_vram_usage(handle)
        if used_vram is not None:
            print(f"    [Memory] RAM: {used_ram:.2f} GB / {total_ram:.2f} GB | VRAM: {used_vram:.2f} GB / {total_vram:.2f} GB")
        else:
            print(f"    [Memory] RAM: {used_ram:.2f} GB / {total_ram:.2f} GB | VRAM: N/A")
        time.sleep(interval)

def main():
    # Initialize NVML to access GPU information
    pynvml.nvmlInit()
    try:
        # Get handle for the first GPU (index 0)
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    except pynvml.NVMLError as error:
        print(f"Error initializing NVML: {error}")
        return

    try:
        # Step 1: Measure and print current system RAM and VRAM usage
        print_memory_usage("Before loading model", handle)

        # Step 2: Load Whisper Large v3 Turbo model into memory
        print("\nLoading Whisper model 'large-v3-turbo' into memory...")
        model_size = "large-v3-turbo"
        device = "cuda"              # Use GPU; change to "cpu" if GPU is unavailable
        compute_type = "float16"     # Use half-precision for faster inference
        start_load_time = time.time()
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        batched_model = BatchedInferencePipeline(model=model)
        load_elapsed = time.time() - start_load_time
        print(f"Model loaded successfully in {load_elapsed:.2f} seconds.")

        # Step 3: Measure and print updated system RAM and VRAM usage
        print_memory_usage("After loading model", handle)

        # Define the list of audio files to transcribe
        audio_files = [
            "short-audio-file.mp3",
            "medium-audio-file.mp3",
            "long-audio-file.mp3"
        ]

        # Iterate over each audio file and perform transcription
        for audio_file in audio_files:
            if not os.path.isfile(audio_file):
                print(f"\nAudio file '{audio_file}' not found. Skipping.")
                continue

            print(f"\nStarting transcription for '{audio_file}'...")
            start_time = time.time()

            # Set up a threading event to stop the memory monitor
            stop_event = threading.Event()
            # Start the memory monitor thread
            monitor_thread = threading.Thread(target=memory_monitor, args=(stop_event, handle))
            monitor_thread.start()

            try:
                # Transcribe the audio file
                transcription = transcribe_audio(batched_model, audio_file, language="fi")
            finally:
                # Stop the memory monitor
                stop_event.set()
                monitor_thread.join()

            elapsed_time = time.time() - start_time
            print(f"Transcription for '{audio_file}' completed in {elapsed_time:.2f} seconds.")
            # Since we're not saving the transcriptions, we can omit that step
    finally:
        # Shutdown NVML to free resources
        pynvml.nvmlShutdown()

if __name__ == "__main__":
    main()
