from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass
class RawSignal:
    """Normalized output from any source provider."""

    source_type: str
    provider: str
    title: str
    summary: str | None
    url: str | None
    published_at: datetime | None
    raw_payload: dict
    source_hash: str


def compute_source_hash(provider: str, unique_id: str) -> str:
    """Deterministic hash for deduplication across runs."""
    return hashlib.sha256(f"{provider}:{unique_id}".encode()).hexdigest()[:16]


class SourceProvider(ABC):
    provider_name: str
    source_type: str

    @abstractmethod
    def fetch(self, topics: list[str], since_hours: int = 24) -> list[RawSignal]:
        """Fetch signals relevant to given topics."""
        ...
