import os
import json
import sys
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
    Expected filename format: unixtimestamp_uploaddate_videoid_videoname.json
    Example: 1222079676_20080922_PLHlE5YN3LE_Joulua Odotellessa.json
    """
    basename = os.path.splitext(filename)[0]  # Remove .json extension
    parts = basename.split('_')
    if len(parts) < 4:
        return None, None  # Invalid format
    youtube_id = parts[2]
    video_name = '_'.join(parts[3:])  # In case video name contains underscores
    return youtube_id, video_name

def search_word_in_transcriptions(search_word, output_folder='output', threshold=80):
    """
    Search for a single word with fuzzy matching in all transcription JSON files.

    Parameters:
    - search_word (str): The word to search for.
    - output_folder (str): Path to the folder containing transcription JSON files.
    - threshold (int): The minimum similarity score (0-100) to consider a match.
    """
    matches = []

    # List all JSON files in the output folder
    try:
        json_files = [f for f in os.listdir(output_folder) if f.endswith('.json')]
    except FileNotFoundError:
        print(f"Error: The folder '{output_folder}' does not exist.")
        sys.exit(1)

    if not json_files:
        print(f"No JSON transcription files found in '{output_folder}'.")
        sys.exit(1)

    # Initialize progress bar
    print(f"Searching for the word: '{search_word}'\n")
    with tqdm(total=len(json_files), desc="Searching", unit="file") as pbar:
        for json_file in json_files:
            json_path = os.path.join(output_folder, json_file)
            youtube_id, video_name = extract_video_info(json_file)
            if not youtube_id or not video_name:
                print(f"Warning: Filename '{json_file}' does not match the expected format.")
                pbar.update(1)
                continue

            # Load JSON data
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except json.JSONDecodeError:
                print(f"Warning: Failed to decode JSON file '{json_file}'. Skipping.")
                pbar.update(1)
                continue

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

            pbar.update(1)

    # Display results
    if matches:
        print(f"\nFound {len(matches)} match{'es' if len(matches) !=1 else ''}:\n")
        for match in matches:
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
