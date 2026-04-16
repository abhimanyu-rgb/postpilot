from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from app.backend.services.sources.base import RawSignal, SourceProvider, compute_source_hash

logger = logging.getLogger("orchestrator")

# Curated RSS feeds organized by category.
# The pipeline fetches all of these, then the Claude scoring step
# filters for relevance to the campaign's topics.
DEFAULT_FEEDS: dict[str, list[str]] = {
    # --- Tech & Industry ---
    "tech": [
        "https://techcrunch.com/feed/",
        "https://www.theverge.com/rss/index.xml",
        "https://feeds.arstechnica.com/arstechnica/index",
        "https://www.wired.com/feed/rss",
        "https://thenewstack.io/feed/",
        "https://spectrum.ieee.org/feeds/feed.rss",
    ],
    # --- AI & Machine Learning ---
    "ai": [
        "https://blog.google/technology/ai/rss/",
        "https://openai.com/blog/rss.xml",
        "https://www.deepmind.com/blog/rss.xml",
        "https://huggingface.co/blog/feed.xml",
        "https://blogs.nvidia.com/feed/",
    ],
    # --- Academic & Research ---
    "academic": [
        "https://news.harvard.edu/gazette/feed/",
        "https://hai.stanford.edu/news/rss.xml",
        "https://www.technologyreview.com/feed/",
        "https://www.nature.com/nature.rss",
        "https://arxiv.org/rss/cs.AI",
        "https://arxiv.org/rss/cs.CL",
        "https://arxiv.org/rss/cs.LG",
        "https://hbswk.hbs.edu/rss/rss.html",
        "https://insight.kellogg.northwestern.edu/feed",
    ],
    # --- Business & Strategy ---
    "business": [
        "https://www.fastcompany.com/latest/rss",
        "https://www.mckinsey.com/insights/rss",
        "https://stratechery.com/feed/",
        "https://www.ben-evans.com/benedictevans?format=rss",
    ],
    # --- Industry & Product ---
    "industry": [
        "https://martinfowler.com/feed.atom",
        "https://www.infoq.com/feed/",
        "https://blog.pragmaticengineer.com/rss/",
        "https://www.lennysnewsletter.com/feed",
        "https://lethain.com/feeds/",
    ],
    # --- Startups & VC ---
    "startups": [
        "https://paulgraham.com/rss.html",
        "https://www.ycombinator.com/blog/rss/",
        "https://www.sequoiacap.com/feed/",
    ],
}


class RSSProvider(SourceProvider):
    provider_name = "rss"
    source_type = "rss"

    def __init__(self, feed_urls: list[str] | None = None):
        if feed_urls:
            self.feed_urls = feed_urls
        else:
            self.feed_urls = [url for urls in DEFAULT_FEEDS.values() for url in urls]

    def fetch(self, topics: list[str], since_hours: int = 24) -> list[RawSignal]:
        signals: list[RawSignal] = []
        topic_lower = [t.lower() for t in topics]

        for feed_url in self.feed_urls:
            try:
                items = self._parse_feed(feed_url)
                for item in items:
                    title = item.get("title", "")
                    summary = item.get("summary", "")
                    text = f"{title} {summary}".lower()

                    # Basic topic relevance filter — at least one topic keyword match
                    if not any(t in text for t in topic_lower):
                        continue

                    url = item.get("url", "")
                    if not url:
                        continue

                    signals.append(
                        RawSignal(
                            source_type=self.source_type,
                            provider=self.provider_name,
                            title=title,
                            summary=summary or None,
                            url=url,
                            published_at=item.get("published_at"),
                            raw_payload=item,
                            source_hash=compute_source_hash(self.provider_name, url),
                        )
                    )
            except Exception as e:
                logger.warning("RSS feed failed (%s): %s", feed_url, e)

        logger.info("RSS fetched %d relevant articles from %d feeds", len(signals), len(self.feed_urls))
        return signals

    def _parse_feed(self, feed_url: str) -> list[dict]:
        resp = httpx.get(feed_url, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        items: list[dict] = []

        # RSS 2.0 format
        for item in root.findall(".//item"):
            items.append(self._parse_rss_item(item))

        # Atom format
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall(".//atom:entry", ns):
            items.append(self._parse_atom_entry(entry, ns))

        # Also try without namespace (some feeds)
        if not items:
            for entry in root.findall(".//entry"):
                items.append(self._parse_atom_entry_no_ns(entry))

        return items

    def _parse_rss_item(self, item: ET.Element) -> dict:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        desc = (item.findtext("description") or "").strip()
        pub_date = item.findtext("pubDate")

        published_at = None
        if pub_date:
            try:
                published_at = parsedate_to_datetime(pub_date)
            except Exception:
                pass

        return {
            "title": title,
            "summary": desc[:500] if desc else "",
            "url": link,
            "published_at": published_at,
            "source": "rss",
        }

    def _parse_atom_entry(self, entry: ET.Element, ns: dict) -> dict:
        title = (entry.findtext("atom:title", namespaces=ns) or "").strip()
        summary = (entry.findtext("atom:summary", namespaces=ns) or "").strip()

        link_el = entry.find("atom:link[@rel='alternate']", ns)
        if link_el is None:
            link_el = entry.find("atom:link", ns)
        url = link_el.get("href", "") if link_el is not None else ""

        updated = entry.findtext("atom:updated", namespaces=ns) or entry.findtext(
            "atom:published", namespaces=ns
        )
        published_at = None
        if updated:
            try:
                published_at = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            except Exception:
                pass

        return {
            "title": title,
            "summary": summary[:500] if summary else "",
            "url": url,
            "published_at": published_at,
            "source": "rss",
        }

    def _parse_atom_entry_no_ns(self, entry: ET.Element) -> dict:
        title = (entry.findtext("title") or "").strip()
        summary = (entry.findtext("summary") or entry.findtext("content") or "").strip()

        link_el = entry.find("link[@rel='alternate']")
        if link_el is None:
            link_el = entry.find("link")
        url = link_el.get("href", "") if link_el is not None else ""

        updated = entry.findtext("updated") or entry.findtext("published")
        published_at = None
        if updated:
            try:
                published_at = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            except Exception:
                pass

        return {
            "title": title,
            "summary": summary[:500] if summary else "",
            "url": url,
            "published_at": published_at,
            "source": "rss",
        }
