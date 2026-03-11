import os
import json
import subprocess
import shutil
import sys
import time
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
YT_DLP_RETRY_DELAY_SECONDS = 2
YT_DLP_RETRYABLE_ERRORS = (
    "the page needs to be reloaded",
    "po token",
    "http error 403",
    "timed out",
    "temporarily unavailable",
    "unable to download",
)

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


def resolve_yt_dlp_binary() -> str:
    """
    Prefer a bundled yt-dlp binary from the workspace, then fall back to PATH.
    """
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    local_candidates = [
        os.path.join(workspace_dir, "yt-dlp.exe"),
        os.path.join(workspace_dir, "yt-dlp"),
    ]

    for candidate in local_candidates:
        if os.path.exists(candidate):
            return candidate

    resolved = shutil.which("yt-dlp")
    if resolved:
        return resolved

    raise FileNotFoundError("yt-dlp executable not found in the workspace or on PATH.")


def get_cookie_args() -> list[str]:
    """
    Use cookies.txt automatically when it exists in the workspace.
    """
    cookie_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
    if os.path.exists(cookie_file):
        return ["--cookies", cookie_file]
    return []


def build_common_download_args(output_template: str) -> list[str]:
    return [
        resolve_yt_dlp_binary(),
        "--no-playlist",
        "--force-ipv4",
        "--socket-timeout", "30",
        "--retries", "3",
        "--fragment-retries", "3",
        "--extractor-retries", "3",
        "-o", output_template,
        *get_cookie_args(),
    ]


def build_download_attempts(download_format: str, output_template: str, video_id: str) -> list[tuple[str, list[str]]]:
    """
    Try stable extractor configurations in order.
    """
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    common_args = build_common_download_args(output_template)
    stable_extractor_args = "youtube:player_client=android,web"
    fallback_extractor_args = "youtube:player_client=android,web;youtube:skip=hls,dash"

    if download_format.lower() == "mp3":
        media_args = [
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
        ]
        return [
            (
                "android-web",
                common_args + ["--extractor-args", stable_extractor_args] + media_args + [video_url],
            ),
            (
                "android-web-skip-streams",
                common_args + ["--extractor-args", fallback_extractor_args] + media_args + [video_url],
            ),
            (
                "android-web-refresh-cache",
                common_args + ["--rm-cache-dir", "--extractor-args", fallback_extractor_args] + media_args + [video_url],
            ),
        ]

    return [
        (
            "android-web-merged",
            common_args
            + ["--extractor-args", stable_extractor_args, "-f", "bv*+ba/b", "--merge-output-format", "mp4", video_url],
        ),
        (
            "android-web-progressive",
            common_args
            + ["--extractor-args", fallback_extractor_args, "-f", "best[ext=mp4]/best", "--merge-output-format", "mp4", video_url],
        ),
        (
            "android-web-refresh-cache",
            common_args
            + ["--rm-cache-dir", "--extractor-args", fallback_extractor_args, "-f", "best[ext=mp4]/best", "--merge-output-format", "mp4", video_url],
        ),
    ]


def is_retryable_download_error(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(error_text in lowered for error_text in YT_DLP_RETRYABLE_ERRORS)


def run_download_with_fallbacks(download_format: str, output_template: str, video_id: str) -> tuple[bool, str]:
    attempts = build_download_attempts(download_format, output_template, video_id)
    last_stderr = ""

    for attempt_index, (attempt_name, cmd) in enumerate(attempts, start=1):
        print(f"  Attempt {attempt_index}/{len(attempts)} with profile: {attempt_name}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return True, result.stderr

        last_stderr = result.stderr.strip()
        if attempt_index < len(attempts) and is_retryable_download_error(last_stderr):
            print("  Retrying with a safer extractor configuration...")
            time.sleep(YT_DLP_RETRY_DELAY_SECONDS)

    return False, last_stderr


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

        output_template = os.path.join(DOWNLOAD_FOLDER, output_base + ".%(ext)s")
        success, stderr = run_download_with_fallbacks(download_format, output_template, vid["id"])
        if success:
            actual_ext = check_existing_file(output_base, DOWNLOAD_FOLDER, download_format) or download_format
            print(f"  Download succeeded: {output_base}.{actual_ext}")
            vid["downloaded"] = True
            write_videos_json(videos_data)
            completed += 1
        else:
            # Log the error
            print(f"  Download failed: {vid['name']}\n    {stderr}\n")
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

    # 3) Ask user if they'd like to download mp3 or mp4, unless provided via argv.
    choice = sys.argv[1].strip().lower() if len(sys.argv) > 1 else ""
    while choice not in ["mp3", "mp4"]:
        choice = input("Download format? (mp3/mp4): ").strip().lower()

    # 4) Download them from oldest to newest
    download_videos(videos_data, choice)

    print("\nAll done!")


if __name__ == "__main__":
    main()
