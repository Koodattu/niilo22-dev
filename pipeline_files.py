"""Shared filename and atomic-file handling for the local media pipeline."""

import json
import os
import re
import tempfile


def parse_video_filename(filename):
    stem = os.path.splitext(os.path.basename(filename))[0]
    # Prefer the generated format, including IDs that start/end with underscores.
    match = re.match(r"^[^_]+_[^_]+_([A-Za-z0-9_-]{11})_(.*)$", stem)
    if not match:
        # Historical files may have an extra separator after the upload date.
        match = re.match(r"^[^_]+_[^_]+__([A-Za-z0-9_-]{11})_(.*)$", stem)
    return match.groups() if match else (None, None)


def write_json_atomic(path, data, indent=2):
    """Replace a JSON file only after its complete replacement has been written."""
    target = os.path.abspath(path)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=os.path.dirname(target), prefix=".niilo22-", suffix=".tmp", delete=False) as output:
            temporary_path = output.name
            json.dump(data, output, ensure_ascii=False, indent=indent)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, target)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
