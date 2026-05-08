"""Headless Playwright scraper for LinkedIn public profile post engagement.

Loads `https://in.linkedin.com/in/<handle>`, dismisses the sign-in modal, and
extracts user-authored posts visible in the public profile carousel: each
post's activity URN, reaction count, comment count, and relative posted-at.

Designed to run from the backend scheduler (no MCP, no interactive browser).
The DOM extraction script and matching algorithm were validated interactively
via chrome-devtools MCP against the live profile.
"""
from __future__ import annotations

import logging
from typing import TypedDict

logger = logging.getLogger("orchestrator")

# Tuned from observed data:
#   activity-vs-share offset: ~10^8 to ~10^9
#   share-vs-prior-share gap: ~10^14
# 10^11 sits cleanly in between.
URN_MATCH_THRESHOLD = 10**11


class ScrapedPost(TypedDict):
    activity_id: str
    url: str
    reactions: int | None
    comments: int | None
    posted_at_relative: str | None
    text_first_120: str


# Extraction script: runs inside the loaded page. The carousel container is
# `div.profile-activity-card`; reactions render as text on the reactions link;
# comment counts are NOT exposed on the public profile (the link is just an
# action button labeled "Comment" with no count). We capture comments as null.
_EXTRACTION_JS = """
() => {
  const cards = document.querySelectorAll('.profile-activity-card');
  const out = [];
  cards.forEach(card => {
    const ownLink = card.querySelector('a[href*="__HANDLE___"][href*="activity-"]');
    if (!ownLink) return;
    const m = ownLink.href.match(/activity-(\\d+)/);
    if (!m) return;
    if (out.some(o => o.activity_id === m[1])) return;

    let reactions = null;
    const reactionLink = card.querySelector('a[href*="reactions"]');
    if (reactionLink) {
      const t = (reactionLink.getAttribute('aria-label') || reactionLink.innerText || '').trim();
      const num = parseInt(t.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) reactions = num;
    }

    const cardText = (card.innerText || '');
    const tsMatch = cardText.match(/^\\s*(\\d+[dhwmy])\\b/m);
    out.push({
      activity_id: m[1],
      url: ownLink.href.split('?')[0],
      reactions: reactions,
      comments: null,  // not exposed publicly
      posted_at_relative: tsMatch ? tsMatch[1] : null,
      text_first_120: cardText.slice(0, 120).replace(/\\s+/g, ' ').trim(),
    });
  });
  return out;
}
"""


def _build_extraction_js(handle: str) -> str:
    """Substitute the user's LinkedIn handle into the extraction selector."""
    safe_handle = handle.replace("'", "").replace('"', "").replace("\\", "")
    return _EXTRACTION_JS.replace("__HANDLE__", safe_handle)


def scrape_profile_posts(handle: str, profile_url: str | None = None, timeout_ms: int = 30000) -> list[ScrapedPost]:
    """Open the LinkedIn public profile, dismiss the sign-in modal, extract posts.

    handle: the LinkedIn vanity name (the `<handle>` in linkedin.com/in/<handle>) —
        used to scope the extractor to user-authored links and avoid related-post noise.
    profile_url: full URL to load. Defaults to https://in.linkedin.com/in/<handle>.
    """
    from playwright.sync_api import sync_playwright

    if not handle:
        raise ValueError("LinkedIn handle is required for scraping")
    url = profile_url or f"https://in.linkedin.com/in/{handle}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 1800},
                locale="en-US",
            )
            page = context.new_page()
            page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")

            # Wait for at least one user-authored post link to appear. The
            # sign-in modal is in the DOM but doesn't block extraction, so we
            # don't need to dismiss it for the scrape to work.
            # state="attached" because the sign-in modal overlays the page and
            # would make matched elements appear "not visible" to Playwright's
            # default visibility check, even though they're in the DOM.
            try:
                page.wait_for_selector(
                    f'a[href*="{handle}_"][href*="activity-"]',
                    timeout=timeout_ms,
                    state="attached",
                )
            except Exception:
                logger.warning("No user posts found on profile %s within %dms", url, timeout_ms)
                return []

            # Give the page a moment to finish hydration so all carousel slides
            # are present in the DOM. Empirically the carousel ships ~25 links
            # within a couple of seconds of initial paint.
            page.wait_for_timeout(1500)

            posts = page.evaluate(_build_extraction_js(handle))
            logger.info("Scraped %d posts from %s", len(posts), url)
            return posts
        finally:
            browser.close()


def match_activity_to_share(activity_id: int, candidate_share_urns: list[str]) -> str | None:
    """Map a scraped activity URN to one of our stored share URNs.

    LinkedIn issues two URNs per post (share, activity), microseconds apart.
    Their numeric values differ by ~10^8 to ~10^9. Adjacent shares differ by
    ~10^14. So nearest-neighbor search with a ~10^11 threshold is robust.
    Returns the matching share URN string or None.
    """
    best, best_diff = None, URN_MATCH_THRESHOLD
    for urn_str in candidate_share_urns:
        try:
            n = int(urn_str.split(":")[-1])
        except (ValueError, AttributeError):
            continue
        d = abs(activity_id - n)
        if d < best_diff:
            best_diff = d
            best = urn_str
    return best
