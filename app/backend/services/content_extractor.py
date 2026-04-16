"""Extract clean article text from URLs using trafilatura.

Used between source fetching and Claude scoring to provide richer context
without wasting tokens on HTML boilerplate.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import trafilatura

from app.backend.models.source_signal import SourceSignal

logger = logging.getLogger("orchestrator")

# Max chars to keep per article — enough context for Claude, not wasteful
MAX_CONTENT_CHARS = 1500
# How many URLs to fetch in parallel
MAX_WORKERS = 8
# Timeout per URL fetch (seconds)
FETCH_TIMEOUT = 12

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def extract_article_content(url: str) -> str | None:
    """Fetch and extract clean text from a single URL.

    Uses httpx with browser-like headers (trafilatura's built-in fetcher
    gets blocked by many sites), then trafilatura for content extraction.
    """
    try:
        resp = httpx.get(
            url,
            headers=BROWSER_HEADERS,
            follow_redirects=True,
            timeout=FETCH_TIMEOUT,
        )
        if resp.status_code != 200 or len(resp.text) < 500:
            return None

        text = trafilatura.extract(
            resp.text,
            include_comments=False,
            include_tables=False,
            no_fallback=False,
        )
        if text and len(text) > 50:
            return text[:MAX_CONTENT_CHARS]
        return None
    except Exception as e:
        logger.debug("Content extraction failed for %s: %s", url, e)
        return None


def enrich_signals_with_content(
    signals: list[SourceSignal],
    run_logger: logging.Logger,
    max_to_enrich: int = 50,
) -> dict[int, str]:
    """Fetch full article content for top signals.

    Returns a dict mapping signal.id -> extracted_text.
    Only enriches signals that have a URL. Runs in parallel for speed.
    """
    # Filter to signals with actual URLs (not reddit self-posts etc.)
    enrichable = [
        s for s in signals
        if s.url_or_ref
        and s.url_or_ref.startswith("http")
        and "reddit.com" not in s.url_or_ref  # Reddit self-text already in summary
    ][:max_to_enrich]

    if not enrichable:
        run_logger.info("No URLs to enrich with content extraction")
        return {}

    run_logger.info("Extracting content from %d article URLs...", len(enrichable))
    results: dict[int, str] = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_signal = {
            executor.submit(extract_article_content, s.url_or_ref): s
            for s in enrichable
            if s.url_or_ref
        }
        for future in as_completed(future_to_signal):
            signal = future_to_signal[future]
            try:
                content = future.result()
                if content:
                    results[signal.id] = content
            except Exception:
                pass

    run_logger.info(
        "Extracted content for %d / %d articles",
        len(results),
        len(enrichable),
    )
    return results
