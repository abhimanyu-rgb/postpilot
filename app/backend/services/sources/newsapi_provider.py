from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.backend.services.sources.base import RawSignal, SourceProvider, compute_source_hash

logger = logging.getLogger("orchestrator")


class NewsAPIProvider(SourceProvider):
    provider_name = "newsapi"
    source_type = "news"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def fetch(self, topics: list[str], since_hours: int = 24) -> list[RawSignal]:
        query = " OR ".join(topics[:5])
        since = datetime.now(timezone.utc) - timedelta(hours=since_hours)

        params = {
            "q": query,
            "from": since.strftime("%Y-%m-%dT%H:%M:%S"),
            "sortBy": "relevancy",
            "language": "en",
            "pageSize": 30,
            "apiKey": self.api_key,
        }

        resp = httpx.get(
            "https://newsapi.org/v2/everything",
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("status") != "ok":
            logger.warning("NewsAPI returned status: %s", data.get("status"))
            return []

        signals = []
        for article in data.get("articles", []):
            url = article.get("url", "")
            if not url:
                continue

            published_at = None
            if article.get("publishedAt"):
                try:
                    published_at = datetime.fromisoformat(
                        article["publishedAt"].replace("Z", "+00:00")
                    )
                except (ValueError, TypeError):
                    pass

            signals.append(
                RawSignal(
                    source_type=self.source_type,
                    provider=self.provider_name,
                    title=article.get("title", ""),
                    summary=article.get("description"),
                    url=url,
                    published_at=published_at,
                    raw_payload=article,
                    source_hash=compute_source_hash(self.provider_name, url),
                )
            )

        logger.info("NewsAPI fetched %d articles for query: %s", len(signals), query)
        return signals
