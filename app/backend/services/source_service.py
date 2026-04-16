from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.backend.core.storage import LocalStorageManager
from app.backend.models.campaign import Campaign
from app.backend.models.source_signal import SourceSignal
from app.backend.services.sources import get_providers

logger = logging.getLogger("orchestrator")


def fetch_sources(
    db: Session,
    run_id: int,
    campaign: Campaign,
    storage: LocalStorageManager,
    run_logger: logging.Logger,
) -> list[SourceSignal]:
    """Fetch signals from all configured source providers.

    Returns persisted SourceSignal records. Catches per-provider errors
    so one failing provider doesn't kill the whole step.
    """
    topics = json.loads(campaign.topics_json)
    source_prefs = json.loads(campaign.source_preferences_json)
    custom_rss: list[str] | None = None
    if hasattr(campaign, "custom_rss_feeds_json") and campaign.custom_rss_feeds_json:
        try:
            custom_rss = json.loads(campaign.custom_rss_feeds_json)
        except (json.JSONDecodeError, TypeError):
            pass
    providers = get_providers(source_prefs, custom_rss_feeds=custom_rss)

    if not providers:
        run_logger.warning("No source providers available for preferences: %s", source_prefs)
        return []

    signals: list[SourceSignal] = []
    today = str(datetime.now().date())

    for provider in providers:
        try:
            raw_signals = provider.fetch(topics)
            run_logger.info(
                "Provider %s returned %d raw signals", provider.provider_name, len(raw_signals)
            )

            for raw in raw_signals:
                existing = (
                    db.query(SourceSignal)
                    .filter(SourceSignal.source_hash == raw.source_hash)
                    .first()
                )
                if existing:
                    continue

                signal = SourceSignal(
                    run_id=run_id,
                    source_type=raw.source_type,
                    provider=raw.provider,
                    title_or_summary=raw.title,
                    url_or_ref=raw.url,
                    published_at=raw.published_at,
                    normalized_payload_json=json.dumps(raw.raw_payload, default=str),
                    source_hash=raw.source_hash,
                )
                db.add(signal)
                signals.append(signal)

                storage.write_source(
                    date=today,
                    provider=raw.provider,
                    source_hash=raw.source_hash,
                    payload=raw.raw_payload,
                )

        except Exception as e:
            run_logger.error("Provider %s failed: %s", provider.provider_name, e)

    db.commit()
    run_logger.info("Persisted %d new signals (deduped)", len(signals))
    return signals
