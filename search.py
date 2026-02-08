import os
import json
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from rapidfuzz import fuzz
from tqdm import tqdm

def format_time(seconds):
    """
    Convert seconds to HH:MM:SS format.
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"{hours:02}:{minutes:02}:{secs:02}"

def extract_video_info(filename):
    """
    Extract youtube_id and video_name from the filename.
    Expected filename formats:
    - unixtimestamp_uploaddate_videoid_videoname.json
    - unixtimestamp_uploaddate__videoid_videoname.json (double underscore variant)
    Example: 1222079676_20080922_PLHlE5YN3LE_Joulua Odotellessa.json
    """
    basename = os.path.splitext(filename)[0]  # Remove .json extension
    parts = basename.split('_')

    # Handle both single and double underscore between date and videoid
    # After splitting, an empty string appears where there were consecutive underscores
    if len(parts) < 4:
        return None, None  # Invalid format

    # Filter out empty strings from double underscores
    parts = [p for p in parts if p]

    if len(parts) < 3:
        return None, None  # Invalid format after filtering

    youtube_id = parts[2]
    video_name = '_'.join(parts[3:]) if len(parts) > 3 else ''  # In case video name contains underscores
    return youtube_id, video_name

def process_file(json_file, output_folder, search_word, threshold):
    """
    Worker function to process a single JSON file and search for matches.
    Returns a list of matches found in this file.
    """
    matches = []
    json_path = os.path.join(output_folder, json_file)
    youtube_id, video_name = extract_video_info(json_file)

    if not youtube_id or not video_name:
        return matches  # Return empty list for invalid format

    # Load JSON data
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError:
        return matches  # Return empty list for invalid JSON

    # Iterate over words and perform fuzzy matching
    for word_entry in data.get('words', []):
        word = word_entry.get('word', '')
        similarity = fuzz.ratio(search_word.lower(), word.lower())
        if similarity >= threshold:
            match_info = {
                "video_id": youtube_id,
                "video_name": video_name,
                "matched_word": word,
                "start_time": word_entry.get('start', 0),
                "end_time": word_entry.get('end', 0),
                "similarity": similarity
            }
            matches.append(match_info)

    return matches

def search_word_in_transcriptions(search_word, output_folder='output', threshold=80, max_workers=None):
    """
    Search for a single word with fuzzy matching in all transcription JSON files using multiprocessing.

    Parameters:
    - search_word (str): The word to search for.
    - output_folder (str): Path to the folder containing transcription JSON files.
    - threshold (int): The minimum similarity score (0-100) to consider a match.
    - max_workers (int): Number of worker processes. None defaults to CPU core count.
    """
    all_matches = []

    # List all JSON files in the output folder
    try:
        json_files = [f for f in os.listdir(output_folder) if f.endswith('.json')]
    except FileNotFoundError:
        print(f"Error: The folder '{output_folder}' does not exist.")
        sys.exit(1)

    if not json_files:
        print(f"No JSON transcription files found in '{output_folder}'.")
        sys.exit(1)

    print(f"Searching for the word: '{search_word}' using multiprocessing")
    print(f"Processing {len(json_files)} files with {max_workers or os.cpu_count()} worker processes...\n")

    # Use ProcessPoolExecutor for true parallelism
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks and create a dictionary mapping futures to filenames
        future_to_file = {
            executor.submit(process_file, json_file, output_folder, search_word, threshold): json_file
            for json_file in json_files
        }

        # Process completed tasks with progress bar
        with tqdm(total=len(json_files), desc="Searching", unit="file") as pbar:
            for future in as_completed(future_to_file):
                json_file = future_to_file[future]
                try:
                    matches = future.result()
                    if matches:
                        all_matches.extend(matches)
                except Exception as exc:
                    print(f"\nWarning: Error processing '{json_file}': {exc}")
                finally:
                    pbar.update(1)

    # Display results
    if all_matches:
        print(f"\nFound {len(all_matches)} match{'es' if len(all_matches) !=1 else ''}:\n")
        for match in all_matches:
            start_formatted = format_time(match['start_time'])
            end_formatted = format_time(match['end_time'])
            youtube_link = f"https://www.youtube.com/watch?v={match['video_id']}&t={int(match['start_time'])}"
            print(f"Video ID: {match['video_id']}")
            print(f"Video Name: {match['video_name']}")
            print(f"Matched Word: {match['matched_word']} (Similarity: {match['similarity']}%)")
            print(f"Timestamp: {start_formatted} - {end_formatted}")
            print(f"Link: {youtube_link}")
            print("-" * 50)
    else:
        print("\nNo matches found.")

def main():
    """
    Main function to execute the search.
    """
    try:
        search_word = input("Enter the word to search for: ").strip()
        if not search_word:
            print("Error: Empty input. Please enter a valid word.")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\nSearch cancelled by user.")
        sys.exit(0)

    search_word = search_word.lower()
    search_word = search_word.replace(" ", "")  # Remove spaces for single word search

    search_word_in_transcriptions(search_word)

if __name__ == "__main__":
    main()
