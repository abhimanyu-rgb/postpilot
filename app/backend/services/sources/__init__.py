from __future__ import annotations

import logging

from app.backend.core.config import settings
from app.backend.services.sources.base import SourceProvider
from app.backend.services.sources.hackernews_provider import HackerNewsProvider
from app.backend.services.sources.newsapi_provider import NewsAPIProvider
from app.backend.services.sources.reddit_provider import RedditProvider
from app.backend.services.sources.rss_provider import RSSProvider

logger = logging.getLogger("orchestrator")


def get_providers(source_preferences: list[str], custom_rss_feeds: list[str] | None = None) -> list[SourceProvider]:
    """Return instantiated providers matching the campaign's source preferences.

    Provider mapping:
      "news"       -> NewsAPI (requires API key) OR RSS fallback
      "rss"        -> RSS feeds (free, no key)
      "reddit"     -> Reddit public JSON API (free, no key)
      "hackernews" -> Hacker News Firebase API (free, no key)
    """
    providers: list[SourceProvider] = []

    for pref in source_preferences:
        if pref == "news":
            if settings.news_api_key:
                providers.append(NewsAPIProvider(api_key=settings.news_api_key))
            else:
                # Fallback: use RSS when no NewsAPI key configured
                logger.info("No NEWS_API_KEY configured, falling back to RSS for 'news' source")
                providers.append(RSSProvider())

        elif pref == "rss":
            if custom_rss_feeds:
                providers.append(RSSProvider(feed_urls=custom_rss_feeds))
            else:
                providers.append(RSSProvider())

        elif pref == "reddit":
            providers.append(RedditProvider())

        elif pref == "hackernews":
            providers.append(HackerNewsProvider())

    # If nothing was configured, give them RSS + Reddit as sensible defaults
    if not providers:
        logger.warning("No providers matched preferences, using RSS + Reddit defaults")
        providers.append(RSSProvider())
        providers.append(RedditProvider())

    return providers
