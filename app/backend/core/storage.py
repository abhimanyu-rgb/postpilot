import json
import os
import time
from pathlib import Path


class LocalStorageManager:
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)

    def ensure_dirs(self) -> None:
        dirs = [
            self.data_dir / "sources",
            self.data_dir / "historical",
            self.data_dir / "drafts",
            self.data_dir / "logs" / "runs",
            self.data_dir / "exports",
            self.data_dir / "backups",
        ]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)

    def _write_json(self, path: Path, data: dict) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
        return path

    def _read_json(self, path: Path) -> dict | None:
        if not path.exists():
            return None
        with open(path) as f:
            return json.load(f)

    def write_source(self, date: str, provider: str, source_hash: str, payload: dict) -> Path:
        path = self.data_dir / "sources" / date / provider / f"{source_hash}.json"
        return self._write_json(path, payload)

    def write_historical(
        self, artifact_type: str, date: str, source_hash: str, payload: dict
    ) -> Path:
        path = self.data_dir / "historical" / artifact_type / date / f"{source_hash}.json"
        return self._write_json(path, payload)

    def write_draft_input(self, draft_id: int, data: dict) -> Path:
        path = self.data_dir / "drafts" / str(draft_id) / "input.json"
        return self._write_json(path, data)

    def write_draft_output(self, draft_id: int, version: int, data: dict) -> Path:
        path = self.data_dir / "drafts" / str(draft_id) / f"output_v{version}.json"
        return self._write_json(path, data)

    def read_artifact(self, relative_path: str) -> dict | None:
        return self._read_json(self.data_dir / relative_path)

    def list_artifacts(self, prefix: str) -> list[Path]:
        target = self.data_dir / prefix
        if not target.exists():
            return []
        return sorted(target.rglob("*.json"))

    def cleanup_older_than(self, prefix: str, days: int) -> int:
        target = self.data_dir / prefix
        if not target.exists():
            return 0
        cutoff = time.time() - (days * 86400)
        removed = 0
        for f in target.rglob("*"):
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
        # Remove empty dirs
        for d in sorted(target.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        return removed
