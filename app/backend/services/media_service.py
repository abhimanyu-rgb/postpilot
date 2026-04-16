"""Source media suggestions (images + links) from the original article URLs.

No image generation — extracts Open Graph images and article links
from the source signals that informed each draft.
"""
from __future__ import annotations

import json
import logging
import re

import httpx
from sqlalchemy.orm import Session

from app.backend.models.candidate_opportunity import CandidateOpportunity
from app.backend.models.draft import Draft
from app.backend.models.selected_opportunity import SelectedOpportunity
from app.backend.models.source_signal import SourceSignal

logger = logging.getLogger("orchestrator")

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html",
}


def suggest_media_for_draft(db: Session, draft_id: int) -> list[dict]:
    """Find relevant images and links from the source articles for a draft.

    Returns a list of media suggestions:
    [
      {
        "type": "image" | "link",
        "url": "https://...",
        "title": "Article title",
        "source_url": "https://original-article.com/...",
        "source_domain": "techcrunch.com"
      }
    ]
    """
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        return []

    # Trace back: draft -> selected -> candidate -> source signals
    sel = db.query(SelectedOpportunity).filter(
        SelectedOpportunity.id == draft.selected_opportunity_id
    ).first()
    if not sel:
        return []

    candidate = db.query(CandidateOpportunity).filter(
        CandidateOpportunity.id == sel.candidate_id
    ).first()
    if not candidate:
        return []

    source_ref_ids = json.loads(candidate.source_refs_json or "[]")
    signals = db.query(SourceSignal).filter(SourceSignal.id.in_(source_ref_ids)).all() if source_ref_ids else []

    # Also get other signals from the same run for broader options
    if not signals:
        signals = db.query(SourceSignal).filter(
            SourceSignal.run_id == candidate.run_id
        ).limit(10).all()

    suggestions: list[dict] = []
    seen_domains: set[str] = set()

    for signal in signals:
        url = signal.url_or_ref
        if not url or not url.startswith("http"):
            continue

        domain = _extract_domain(url)
        if domain in seen_domains:
            continue
        seen_domains.add(domain)

        # Always suggest the article link
        suggestions.append({
            "type": "link",
            "url": url,
            "title": signal.title_or_summary or "",
            "source_url": url,
            "source_domain": domain,
        })

        # Try to extract OG image from the article
        og_image = _fetch_og_image(url)
        if og_image:
            suggestions.append({
                "type": "image",
                "url": og_image,
                "title": signal.title_or_summary or "",
                "source_url": url,
                "source_domain": domain,
            })

        if len(suggestions) >= 6:
            break

    # Save to draft
    draft.media_suggestions_json = json.dumps(suggestions)
    db.commit()

    return suggestions


def _fetch_og_image(url: str) -> str | None:
    """Fetch Open Graph image from a URL (fast — just reads <head>)."""
    try:
        resp = httpx.get(
            url,
            headers=BROWSER_HEADERS,
            follow_redirects=True,
            timeout=8,
        )
        if resp.status_code != 200:
            return None

        # Only parse the head — don't download the whole page
        head = resp.text[:10000]

        # Look for og:image
        match = re.search(
            r'<meta\s+(?:property|name)=["\']og:image["\']\s+content=["\']([^"\']+)["\']',
            head,
            re.IGNORECASE,
        )
        if not match:
            match = re.search(
                r'<meta\s+content=["\']([^"\']+)["\']\s+(?:property|name)=["\']og:image["\']',
                head,
                re.IGNORECASE,
            )
        if match:
            img_url = match.group(1)
            if img_url.startswith("http"):
                return img_url

        return None
    except Exception:
        return None


def _extract_domain(url: str) -> str:
    try:
        return url.split("/")[2].replace("www.", "")
    except (IndexError, AttributeError):
        return ""
