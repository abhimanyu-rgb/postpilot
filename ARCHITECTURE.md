# PostPilot — Architecture & Capabilities

## What This System Does
PostPilot is a local-first AI-powered LinkedIn content engine that:
1. Scrapes 32 RSS feeds + Reddit + Hacker News for trending content daily
2. Ranks signals by topic relevance using TF-IDF
3. Extracts full article content using trafilatura
4. Uses Claude (Anthropic) to score opportunities and generate LinkedIn post drafts
5. Presents drafts for human review with edit, polish, and approve/reject workflows
6. Publishes approved posts to LinkedIn via OAuth API
7. Collects post performance feedback to improve future content

## Pipeline Flow
```
Source Fetching (RSS, Reddit, HN) → 3500+ signals
  ↓
TF-IDF Pre-Ranking → top 50 most relevant
  ↓
Content Extraction (trafilatura) → enriched with article body text
  ↓
Claude Scoring → 3-8 candidate opportunities with relevance + novelty scores
  ↓
Selection → top N by daily budget
  ↓
Claude Draft Generation → LinkedIn posts (status: pending_review)
  ↓
Slack Notification → rich preview with Approve/Reject buttons
  ↓
Human Review → edit, polish with AI, approve/reject
  ↓
Publish to LinkedIn → via OAuth API
  ↓
Feedback Loop → performance data fed back into next run's prompts
```

## Where Personality/Voice Data Is Used

### 1. Campaign Configuration (user-defined)
Each campaign has:
- **persona**: free text describing the author's identity and angle (e.g., "Senior product leader sharing insights on building AI products")
- **tone**: one of professional, conversational, thought-leader, casual, analytical
- **topics**: list of topic keywords (e.g., ["AI", "Agents", "Retail Workflows"])
- **profile_adherence_override**: low / medium / high — controls how strictly the voice should match

### 2. Scoring Prompt (system prompt to Claude)
File: `app/backend/services/scoring_service.py`
The system prompt includes:
```
## Campaign Context
- Topics of expertise: {topics}
- Persona: {persona}
- Tone: {tone}

## Learnings from Past Posts (if feedback exists)
- Post 1 (Performance: great) — What worked: ..., Improvement notes: ...
```
Claude uses this to identify content opportunities that match the author's voice and audience.

### 3. Draft Generation Prompt (system prompt to Claude)
File: `app/backend/services/draft_service.py`
The system prompt includes:
```
## Author Profile
- Topics of expertise: {topics}
- Persona: {persona}
- Tone: {tone}

## Learnings from Past Posts
(same feedback context)

## LinkedIn Post Guidelines
- Length, structure, hook, body, ending guidelines
- No hashtag spam, write in first person as the author
```

### 4. Polish/Rewrite Prompt
File: `app/backend/services/draft_review_service.py`
When user clicks "Polish with AI", Claude gets:
```
## Author Profile
- Topics: {topics}
- Persona: {persona}
- Tone: {tone}
```

### 5. Feedback Loop
File: `app/backend/services/feedback_service.py`
After publishing, users rate posts (great/good/average/poor) and add notes:
- What worked / What didn't
- Improvement notes for future posts
- Effective elements tags (strong_hook, personal_story, data_driven, etc.)

This feedback is injected into scoring + draft prompts on the next run (token-budgeted to ~800 tokens).

### 6. Personality Profile Model (exists but not yet populated)
File: `app/backend/models/personality_profile.py`
Schema ready for:
- voice_traits_json
- structure_preferences_json
- topic_affinities_json
- engagement_patterns_json
- profile_summary
- adherence_strength

**This is where personality.md content should map to.** The system is designed to load a personality profile and use it to constrain/guide draft generation.

## How personality.md Should Be Structured

For maximum compatibility with this system, the personality file should include:

### Voice Traits
- Writing style patterns (sentence length, vocabulary level, formality)
- First-person vs third-person tendencies
- Use of questions, exclamations, ellipses
- Signature phrases or patterns

### Structure Preferences
- Typical post length (chars)
- Hook style (question, bold statement, statistic, story)
- Body structure (short paragraphs, lists, single-line breaks)
- Ending style (question, CTA, reflection)
- Hashtag/emoji usage

### Topic Affinities
- Primary topics with depth level
- Adjacent topics they connect to
- Topics they avoid or rarely touch

### Engagement Patterns
- What types of posts get highest engagement
- Best performing narrative types (trend_analysis, hot_take, practical_insight, story, contrarian_view)
- Optimal posting times and frequency

### Tone Profile
- Spectrum: provocative ←→ measured
- Spectrum: personal ←→ professional
- Spectrum: optimistic ←→ critical
- Use of humor, vulnerability, authority

## Tech Stack
- Backend: Python/FastAPI + SQLAlchemy + SQLite/Postgres
- Frontend: Next.js 16 + React 19 + Tailwind CSS
- LLM: Anthropic Claude (Sonnet) with prompt caching
- Sources: RSS (32 feeds), Reddit, Hacker News
- Auth: LinkedIn OAuth 2.0
- Notifications: Slack webhooks with action buttons
