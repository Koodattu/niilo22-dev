import os
import json
from tqdm import tqdm  # Import tqdm for the progress bar

def create_sentences_from_json(output_folder, output_file):
    """
    Reads JSON files from the specified folder, extracts words,
    and creates a single text file with all the words forming sentences.
    Each sentence is written on one line, and no empty rows are included.
    """
    all_sentences = []
    json_files = [f for f in os.listdir(output_folder) if f.endswith(".json")]
    
    # Initialize tqdm progress bar
    with tqdm(total=len(json_files), desc="Processing JSON files", unit="file") as progress_bar:
        for file_name in json_files:
            file_path = os.path.join(output_folder, file_name)
            
            # Open and parse the JSON file
            with open(file_path, 'r', encoding='utf-8') as json_file:
                data = json.load(json_file)
                words = data.get("words", [])
                
                # Extract and clean words
                sentence = ""
                for word_info in words:
                    word = word_info.get("word", "")
                    
                    # Add a space after punctuation if needed
                    if word.endswith((",", ".", "?", "!", ":")):
                        sentence += word + " "
                    else:
                        sentence += word + " "
                
                # Add the sentence to the collection if not empty
                if sentence.strip():
                    all_sentences.append(sentence.strip())
            
            # Update the progress bar
            progress_bar.update(1)
    
    # Write all sentences to the output file, one per line
    with open(output_file, 'w', encoding='utf-8') as text_file:
        for sentence in all_sentences:
            text_file.write(sentence + "\n")
    
    print(f"\nText file '{output_file}' created successfully with content from JSON files.")

# Define paths
output_folder = "output"  # Folder containing JSON files
output_file = "combined_words.txt"  # Output text file

# Execute the function
create_sentences_from_json(output_folder, output_file)
