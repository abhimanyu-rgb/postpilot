from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.backend.services.sources.base import RawSignal, SourceProvider, compute_source_hash

logger = logging.getLogger("orchestrator")

# Subreddits mapped to common campaign topic categories.
# Multiple subreddits per category catch broader signal.
TOPIC_SUBREDDITS: dict[str, list[str]] = {
    "ai": ["artificial", "MachineLearning", "LocalLLaMA", "ChatGPT", "singularity"],
    "tech": ["technology", "programming", "webdev", "startups"],
    "saas": ["SaaS", "startups", "Entrepreneur"],
    "product": ["ProductManagement", "UXDesign", "startups"],
    "marketing": ["marketing", "socialmedia", "content_marketing", "digital_marketing"],
    "business": ["business", "Entrepreneur", "smallbusiness"],
    "leadership": ["leadership", "management", "Entrepreneur"],
    "data": ["datascience", "dataengineering", "analytics"],
    "cloud": ["aws", "googlecloud", "azure", "devops"],
    "crypto": ["CryptoCurrency", "ethereum", "Bitcoin"],
    "research": ["science", "compsci", "AcademicPapers", "Scholar"],
    "education": ["highereducation", "AcademicPhilosophy", "edtech"],
    "healthcare": ["HealthIT", "digitalhealth", "medicine"],
    "fintech": ["fintech", "algotrading", "Banking"],
    "retail": ["retail", "ecommerce", "supplychain"],
    "sustainability": ["sustainability", "RenewableEnergy", "CleanEnergy"],
}

# Fallback subreddits if no topic match
DEFAULT_SUBREDDITS = ["technology", "business", "Futurology"]

USER_AGENT = "LinkedInOrchestrator/0.1 (content-research-bot)"


class RedditProvider(SourceProvider):
    provider_name = "reddit"
    source_type = "reddit"

    def fetch(self, topics: list[str], since_hours: int = 24) -> list[RawSignal]:
        subreddits = self._resolve_subreddits(topics)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
        signals: list[RawSignal] = []
        seen_urls: set[str] = set()

        for sub in subreddits:
            try:
                posts = self._fetch_subreddit(sub, cutoff)
                for post in posts:
                    url = post.get("url", "")
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)

                    title = post.get("title", "")
                    selftext = post.get("selftext", "")
                    summary = selftext[:500] if selftext else post.get("link_title", "")

                    signals.append(
                        RawSignal(
                            source_type=self.source_type,
                            provider=self.provider_name,
                            title=title,
                            summary=summary or None,
                            url=url,
                            published_at=post.get("created_utc"),
                            raw_payload=post,
                            source_hash=compute_source_hash(self.provider_name, post["id"]),
                        )
                    )
            except Exception as e:
                logger.warning("Reddit fetch failed for r/%s: %s", sub, e)

        logger.info("Reddit fetched %d posts from %d subreddits", len(signals), len(subreddits))
        return signals

    def _resolve_subreddits(self, topics: list[str]) -> list[str]:
        """Map campaign topics to relevant subreddits."""
        subs: set[str] = set()
        for topic in topics:
            topic_lower = topic.lower().strip()
            for key, subreddit_list in TOPIC_SUBREDDITS.items():
                if key in topic_lower or topic_lower in key:
                    subs.update(subreddit_list)

        if not subs:
            subs.update(DEFAULT_SUBREDDITS)

        # Cap to avoid too many requests
        return list(subs)[:8]

    def _fetch_subreddit(self, subreddit: str, cutoff: datetime) -> list[dict]:
        """Fetch hot posts from a subreddit using the public JSON API."""
        url = f"https://www.reddit.com/r/{subreddit}/hot.json"
        resp = httpx.get(
            url,
            params={"limit": 25, "raw_json": 1},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()

        posts: list[dict] = []
        for child in data.get("data", {}).get("children", []):
            post = child.get("data", {})

            # Skip pinned, removed, or very low engagement
            if post.get("stickied") or post.get("removed_by_category"):
                continue
            if post.get("score", 0) < 10:
                continue

            created = post.get("created_utc", 0)
            created_dt = datetime.fromtimestamp(created, tz=timezone.utc)
            if created_dt < cutoff:
                continue

            # Build a clean permalink
            permalink = post.get("permalink", "")
            reddit_url = f"https://www.reddit.com{permalink}" if permalink else ""

            posts.append(
                {
                    "id": post.get("id", ""),
                    "title": post.get("title", ""),
                    "selftext": (post.get("selftext") or "")[:1000],
                    "url": post.get("url", reddit_url),
                    "reddit_url": reddit_url,
                    "subreddit": subreddit,
                    "score": post.get("score", 0),
                    "num_comments": post.get("num_comments", 0),
                    "created_utc": created_dt,
                    "author": post.get("author", ""),
                    "link_title": post.get("link_flair_text", ""),
                }
            )

        return posts
