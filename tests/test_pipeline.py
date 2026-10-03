import importlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from search import process_file
from transcribe import transcribe_file

# Importing the downloader must not load a user's API credentials for a test.
with patch("dotenv.load_dotenv"):
    downloader = importlib.import_module("download")


class PipelineTests(unittest.TestCase):
    def test_transcription_and_local_search_preserve_underscore_video_id(self):
        with tempfile.TemporaryDirectory(prefix="niilo22-pipeline-test-") as directory:
            filename = "1700000000_20231114_test_id0002_Aamu_kahvi.mp3"
            model = SimpleNamespace(transcribe=lambda *args, **kwargs: ([SimpleNamespace(words=[SimpleNamespace(word="kahvi", start=30, end=31)])], None))
            self.assertTrue(transcribe_file(str(Path(directory, filename)), directory, str(Path(directory, "progress.txt")), model, set()))
            transcript = Path(directory, filename).with_suffix(".json")
            self.assertEqual(json.loads(transcript.read_text(encoding="utf-8"))["youtube_id"], "test_id0002")
            matches = process_file(transcript.name, directory, "kahvi", 100)
            self.assertEqual(matches[0]["video_id"], "test_id0002")
            self.assertEqual(matches[0]["video_name"], "Aamu_kahvi")
            self.assertEqual(matches[0]["start_time"], 30)

    def test_corrupt_metadata_is_not_treated_as_an_empty_archive(self):
        with tempfile.TemporaryDirectory(prefix="niilo22-pipeline-test-") as directory:
            path = Path(directory, "videos.json")
            path.write_text('{"videos":', encoding="utf-8")
            with patch.object(downloader, "VIDEOS_JSON", str(path)):
                with self.assertRaises(ValueError):
                    downloader.read_videos_json()
            self.assertEqual(path.read_text(encoding="utf-8"), '{"videos":')

    def test_failed_metadata_serialization_keeps_the_previous_file(self):
        with tempfile.TemporaryDirectory(prefix="niilo22-pipeline-test-") as directory:
            path = Path(directory, "videos.json")
            original = '{"videos": []}'
            path.write_text(original, encoding="utf-8")
            with patch.object(downloader, "VIDEOS_JSON", str(path)):
                with self.assertRaises(TypeError):
                    downloader.write_videos_json({"videos": [object()]})
            self.assertEqual(path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
