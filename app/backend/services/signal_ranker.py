"""TF-IDF based pre-ranking of source signals by topic relevance.

Runs BEFORE Claude scoring to filter 3,500+ signals down to the top ~50
most relevant, saving tokens and improving scoring quality.
"""
from __future__ import annotations

import logging

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.backend.models.source_signal import SourceSignal

logger = logging.getLogger("orchestrator")


def rank_signals_by_relevance(
    signals: list[SourceSignal],
    topics: list[str],
    top_n: int = 50,
    run_logger: logging.Logger | None = None,
) -> list[SourceSignal]:
    """Rank signals by TF-IDF cosine similarity to campaign topics.

    1. Build a TF-IDF matrix from all signal titles + summaries
    2. Create a "query" vector from the campaign topics
    3. Rank signals by cosine similarity to the query
    4. Return the top N most relevant
    """
    log = run_logger or logger

    if len(signals) <= top_n:
        log.info("Only %d signals, skipping TF-IDF ranking", len(signals))
        return signals

    # Build text corpus from signals
    corpus = []
    for s in signals:
        text = (s.title_or_summary or "").strip()
        corpus.append(text)

    # The "query" is the campaign topics joined
    query = " ".join(topics)

    try:
        vectorizer = TfidfVectorizer(
            max_features=5000,
            stop_words="english",
            ngram_range=(1, 2),
            min_df=1,
            max_df=0.95,
        )

        # Fit on corpus + query together
        all_texts = corpus + [query]
        tfidf_matrix = vectorizer.fit_transform(all_texts)

        # Query vector is the last row
        query_vec = tfidf_matrix[-1:]
        signal_vecs = tfidf_matrix[:-1]

        # Compute cosine similarity between query and each signal
        similarities = cosine_similarity(query_vec, signal_vecs).flatten()

        # Get top N indices
        top_indices = np.argsort(similarities)[::-1][:top_n]

        ranked = [signals[i] for i in top_indices if similarities[i] > 0]

        log.info(
            "TF-IDF ranking: %d -> %d signals (top score=%.3f, cutoff score=%.3f)",
            len(signals),
            len(ranked),
            float(similarities[top_indices[0]]) if len(top_indices) > 0 else 0,
            float(similarities[top_indices[-1]]) if len(top_indices) > 0 else 0,
        )
        return ranked

    except Exception as e:
        log.error("TF-IDF ranking failed, returning most recent %d: %s", top_n, e)
        # Fallback: return most recent by published_at
        sorted_signals = sorted(
            signals,
            key=lambda s: s.published_at or "",
            reverse=True,
        )
        return sorted_signals[:top_n]
