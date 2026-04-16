from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.backend.services.sources.base import RawSignal, SourceProvider, compute_source_hash

logger = logging.getLogger("orchestrator")

HN_API = "https://hacker-news.firebaseio.com/v0"


class HackerNewsProvider(SourceProvider):
    provider_name = "hackernews"
    source_type = "hackernews"

    def fetch(self, topics: list[str], since_hours: int = 24) -> list[RawSignal]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
        topic_lower = [t.lower() for t in topics]

        # Fetch top + best stories for broader coverage
        story_ids = self._get_story_ids("topstories") + self._get_story_ids("beststories")
        # Deduplicate and cap
        story_ids = list(dict.fromkeys(story_ids))[:80]

        signals: list[RawSignal] = []

        for sid in story_ids:
            try:
                story = self._get_item(sid)
                if not story or story.get("type") != "story":
                    continue
                if story.get("dead") or story.get("deleted"):
                    continue

                created = story.get("time", 0)
                created_dt = datetime.fromtimestamp(created, tz=timezone.utc)
                if created_dt < cutoff:
                    continue

                title = story.get("title", "")
                url = story.get("url", "")
                # Self-posts (Ask HN, Show HN) link to the HN comments page
                if not url:
                    url = f"https://news.ycombinator.com/item?id={sid}"

                text = title.lower()
                if not any(t in text for t in topic_lower):
                    continue

                # Minimum engagement filter
                score = story.get("score", 0)
                if score < 20:
                    continue

                signals.append(
                    RawSignal(
                        source_type=self.source_type,
                        provider=self.provider_name,
                        title=title,
                        summary=f"Score: {score} | Comments: {story.get('descendants', 0)}",
                        url=url,
                        published_at=created_dt,
                        raw_payload={
                            "id": sid,
                            "title": title,
                            "url": url,
                            "score": score,
                            "descendants": story.get("descendants", 0),
                            "by": story.get("by", ""),
                            "created_utc": str(created_dt),
                            "hn_url": f"https://news.ycombinator.com/item?id={sid}",
                        },
                        source_hash=compute_source_hash(self.provider_name, str(sid)),
                    )
                )
            except Exception as e:
                logger.debug("HN item %d failed: %s", sid, e)

        logger.info("Hacker News fetched %d relevant stories", len(signals))
        return signals

    def _get_story_ids(self, endpoint: str) -> list[int]:
        resp = httpx.get(f"{HN_API}/{endpoint}.json", timeout=10)
        resp.raise_for_status()
        return resp.json()[:50]

    def _get_item(self, item_id: int) -> dict | None:
        resp = httpx.get(f"{HN_API}/item/{item_id}.json", timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json()
