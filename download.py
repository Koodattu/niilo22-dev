import os
import json
import subprocess
from datetime import datetime, timezone
from dotenv import load_dotenv
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

###############################################################################
#                            Environment & Globals
###############################################################################
load_dotenv()  # Load .env file

YT_API_KEY = os.getenv("YT_API_KEY", "").strip()
YT_CHANNEL = os.getenv("YT_CHANNEL", "").strip()

# If you want to override from .env:
DOWNLOAD_FOLDER = os.getenv("DOWNLOAD_FOLDER", "videos").strip()
VIDEOS_JSON = "videos.json"

###############################################################################
#                        Utility / Helper Functions
###############################################################################
def sanitize_filename(title: str) -> str:
    """
    Remove problematic characters for filenames and normalize spaces.
    """
    problematic_chars = '\\/:\"*?<>|'
    translation_table = str.maketrans({char: '-' for char in problematic_chars})
    sanitized = title.translate(translation_table)
    sanitized = " ".join(sanitized.split())  # normalize whitespace
    return sanitized


def read_videos_json() -> dict:
    """
    Read and return the data from videos.json if it exists, else return a default structure.
    The JSON structure we expect is:
      {
        "lastUpdated": "...",
        "videos": [
          {
            "id": "...",
            "name": "...",
            "publishedAt": "...",
            "downloaded": false
          },
          ...
        ]
      }
    """
    if not os.path.exists(VIDEOS_JSON):
        return {"lastUpdated": None, "videos": []}

    try:
        with open(VIDEOS_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        print(f"Error reading {VIDEOS_JSON}; starting fresh.")
        return {"lastUpdated": None, "videos": []}


def write_videos_json(data: dict):
    """
    Write updated data to videos.json (pretty-printed JSON).
    """
    data["lastUpdated"] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    with open(VIDEOS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def video_already_in_db(videos_data: dict, video_id: str) -> bool:
    """
    Check if a video with this ID is already stored.
    """
    for v in videos_data["videos"]:
        if v["id"] == video_id:
            return True
    return False


def get_unix_timestamp_and_date_string(published_at: str):
    """
    Convert publishedAt string (2023-01-01T12:34:56Z) into:
      - Unix timestamp (int)
      - A date string in YYYYMMDD format
    """
    dt = datetime.strptime(published_at, '%Y-%m-%dT%H:%M:%SZ')
    unix_timestamp = int(dt.timestamp())
    date_string = dt.strftime('%Y%m%d')
    return unix_timestamp, date_string


###############################################################################
#                     1) Fetch Videos from YouTube API
###############################################################################
def get_channel_id(youtube, channel_name: str) -> str:
    """
    Attempt to resolve channel ID from a channel name or handle using:
      1) channels.list(forUsername=...)
      2) channels.list(id=...) [if there's an '@' handle, remove the '@']
      3) search.list(q=..., type=channel)
    """
    # 1) Try forUsername
    try:
        request = youtube.channels().list(
            part="id",
            forUsername=channel_name
        )
        response = request.execute()
        if response["items"]:
            return response["items"][0]["id"]
    except HttpError:
        pass

    # 2) Try id=...
    try:
        request = youtube.channels().list(
            part="id",
            id=channel_name.replace("@", "")
        )
        response = request.execute()
        if response["items"]:
            return response["items"][0]["id"]
    except HttpError:
        pass

    # 3) Fallback to search
    search_request = youtube.search().list(
        part="snippet",
        q=channel_name,
        type="channel",
        maxResults=1
    )
    search_response = search_request.execute()
    if search_response["items"]:
        return search_response["items"][0]["snippet"]["channelId"]

    raise ValueError(f"Could not find channel with name/handle: {channel_name}")


def fetch_new_videos(videos_data: dict):
    if not YT_API_KEY:
        print("ERROR: YouTube API key not found. Set YT_API_KEY in .env.")
        return

    if not YT_CHANNEL:
        print("ERROR: YouTube channel name/handle not found. Set YT_CHANNEL in .env.")
        return

    print(f"Fetching videos for channel: {YT_CHANNEL}")

    youtube = build("youtube", "v3", developerKey=YT_API_KEY)
    channel_id = get_channel_id(youtube, YT_CHANNEL)
    print(f"DEBUG: Resolved channel_id => {channel_id}")

    # Get the channel's 'uploads' playlist
    try:
        ch_request = youtube.channels().list(part="contentDetails", id=channel_id)
        ch_response = ch_request.execute()
        print("DEBUG: ch_response =>", ch_response)
        uploads_playlist_id = ch_response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
    except Exception as e:
        print(f"Error getting uploads playlist: {e}")
        return

    new_videos = []
    next_page_token = None
    total_fetched = 0
    stop_fetching = False

    while True:
        try:
            req = youtube.playlistItems().list(
                part="snippet",
                playlistId=uploads_playlist_id,
                maxResults=50,
                pageToken=next_page_token
            )
            resp = req.execute()
            items = resp.get("items", [])

            # Process from newest to oldest in this batch
            for item in items:
                snippet = item["snippet"]
                vid_id = snippet["resourceId"]["videoId"]
                if video_already_in_db(videos_data, vid_id):
                    # We'll mark a flag, but still finish this page
                    stop_fetching = True
                else:
                    vid_title = snippet["title"]
                    published_at = snippet["publishedAt"]
                    new_videos.append({
                        "id": vid_id,
                        "name": vid_title,
                        "publishedAt": published_at,
                        "downloaded": False
                    })
                    total_fetched += 1
                    print(f"  Found NEW video: {vid_id} | {vid_title}")

            # If there's no next page or we've encountered an old video, break
            next_page_token = resp.get("nextPageToken")
            if not next_page_token or stop_fetching:
                break

        except HttpError as he:
            print(f"Error while fetching playlist items: {he}")
            break

    # Insert these new videos into our main data
    if new_videos:
        # Combine old + new, deduplicate, sort
        combined = videos_data["videos"] + new_videos
        combined_dict = {v["id"]: v for v in combined}
        combined_list = list(combined_dict.values())
        combined_list.sort(key=lambda x: x["publishedAt"])  # oldest first
        videos_data["videos"] = combined_list

        write_videos_json(videos_data)
        print(f"Fetched {total_fetched} new videos. Updated {VIDEOS_JSON}.")
    else:
        print("No new videos found.")


###############################################################################
#                      2) Download Videos (MP3 or MP4)
###############################################################################
def download_videos(videos_data: dict, download_format: str):
    """
    Downloads all videos from oldest to newest in the specified format.
    Skips videos that are marked as downloaded = True or if a file is found locally.
    Updates `videos.json` with `downloaded=True` after each successful download.
    """
    # Ensure download folder
    if not os.path.exists(DOWNLOAD_FOLDER):
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

    # Sort the videos from oldest to newest
    sorted_videos = sorted(videos_data["videos"], key=lambda x: x["publishedAt"])

    total_videos = len(sorted_videos)
    completed = 0
    for idx, vid in enumerate(sorted_videos, start=1):
        if vid.get("downloaded", False):
            completed += 1
            print(f"[{idx}/{total_videos}] Skipping, already downloaded: {vid['name']}")
            continue

        # Check if file already exists (just in case)
        sanitized_title = sanitize_filename(vid["name"])
        unix_ts, date_str = get_unix_timestamp_and_date_string(vid["publishedAt"])
        output_base = f"{unix_ts}_{date_str}_{vid['id']}_{sanitized_title}"
        found_ext = check_existing_file(output_base, DOWNLOAD_FOLDER, download_format)
        if found_ext:
            # Mark as downloaded
            vid["downloaded"] = True
            write_videos_json(videos_data)
            print(f"[{idx}/{total_videos}] File already exists ({output_base}.{found_ext}). Skipped.")
            completed += 1
            continue

        # Otherwise, let's download
        print(f"[{idx}/{total_videos}] Downloading: {vid['name']}")

        if download_format.lower() == "mp3":
            # Audio only, best quality
            cmd = [
                "./yt-dlp",  # or "yt-dlp" if it's on PATH
                "-o", os.path.join(DOWNLOAD_FOLDER, output_base + ".%(ext)s"),
				#'--cookies', 'cookies.txt',
                "--cookies-from-browser", "firefox",
                "-f", "bestaudio/best",
                "--extract-audio",
                "--audio-format", "mp3",
                "--audio-quality", "0",
                f"https://www.youtube.com/watch?v={vid['id']}"
            ]
        else:
            # mp4 (best video + best audio merged)
            cmd = [
                "./yt-dlp",
                "-o", os.path.join(DOWNLOAD_FOLDER, output_base + ".%(ext)s"),
				'--cookies', 'cookies.txt',
                "-f", "bestvideo+bestaudio/best",
                "--merge-output-format", "mp4",
                f"https://www.youtube.com/watch?v={vid['id']}"
            ]

        ret = subprocess.run(cmd, capture_output=True, text=True)
        if ret.returncode == 0:
            print(f"  Download succeeded: {output_base}.{download_format}")
            vid["downloaded"] = True
            write_videos_json(videos_data)
            completed += 1
        else:
            # Log the error
            print(f"  Download failed: {vid['name']}\n    {ret.stderr}\n")
            # Decide if you want to continue or break on failure
            # We'll just continue

    print(f"Download process complete. Total videos: {total_videos}, Downloaded/Skipped: {completed}.")


def check_existing_file(output_base: str, folder: str, download_format: str):
    """
    Checks if there's already a file in `folder` that starts with `output_base`
    and has the appropriate extension for the chosen format.
    Returns the extension if found, None otherwise.
    """
    ext_candidates = []
    if download_format.lower() == "mp3":
        ext_candidates = [".mp3"]
    else:
        # For mp4 scenario, the final merged file might be .mp4
        ext_candidates = [".mp4", ".mkv", ".webm"]  # yt-dlp might produce these if needed

    for fname in os.listdir(folder):
        if fname.startswith(output_base):
            # Check ext
            _, ext = os.path.splitext(fname)
            if ext.lower() in ext_candidates:
                return ext.lower().lstrip(".")
    return None


###############################################################################
#                                   main()
###############################################################################
def main():
    # 1) Load the current videos.json
    videos_data = read_videos_json()

    # 2) Fetch new videos from the YouTube channel
    print("=" * 60)
    fetch_new_videos(videos_data)
    print("=" * 60)

    # 3) Ask user if they'd like to download mp3 or mp4
    #    (Or you could parse sys.argv if you prefer.)
    choice = ""
    while choice.lower() not in ["mp3", "mp4"]:
        choice = input("Download format? (mp3/mp4): ").strip().lower()

    # 4) Download them from oldest to newest
    download_videos(videos_data, choice)

    print("\nAll done!")


if __name__ == "__main__":
    main()
