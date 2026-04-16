# PostPilot — Architecture & Capabilities

## What This System Does
PostPilot is a local-first AI-powered LinkedIn content engine that:
1. Scrapes 32 RSS feeds + Reddit + Hacker News for trending content daily
2. Ranks signals by topic relevance using TF-IDF
3. Extracts full article content using trafilatura
4. Uses Claude (Anthropic) to score opportunities and generate LinkedIn post drafts
5. Checks new drafts against your voice memory for consistency
6. Presents drafts for human review with edit, polish, and approve/reject workflows
7. Queues approved posts for publishing within campaign time windows
8. Publishes to LinkedIn via OAuth API with FIFO ordering and global daily limits
9. Collects immutable post performance feedback
10. Evolves the personality profile based on long-term feedback patterns

## Pipeline Flow
```
Source Fetching (RSS, Reddit, HN) --> 3500+ signals
  |
TF-IDF Pre-Ranking --> top 50 most relevant
  |
Content Extraction (trafilatura) --> enriched with article body text
  |
Claude Scoring --> 3-8 candidate opportunities (relevance + novelty)
  |                  Inputs: guardrails > source > feedback > personality
  |
Selection --> top N by daily budget
  |
Claude Draft Generation --> LinkedIn posts (status: pending_review)
  |                          Inputs: guardrails > source > feedback > personality
  |
Voice Drift Check --> compares against recent published positions
  |                    Flags contradictions as low/medium/high severity
  |
Human Review --> edit, polish with AI, approve/reject, revert
  |              Media suggestions (OG images + links from sources)
  |
Publish Queue --> FIFO order, campaign time windows, global daily limit
  |
LinkedIn API --> published post
  |
Voice Snapshot Update --> rolling summary of last 30 days of posts
  |
Feedback (immutable) --> performance rating + quick note + element tags
  |
Personality Evolution --> every 10 feedbacks, suggest profile updates
```

## LLM Prompt Priority Order
All Claude calls follow this priority (highest first):
1. **Content guardrails** (strict rules, never violated)
2. **Source content** (ground the post in real facts)
3. **Feedback learnings** (apply what worked, avoid what didn't)
4. **Personality profile** (match the author's voice)

## Where Personality/Voice Data Is Used

### 1. Campaign Configuration (user-defined per campaign)
- `persona`: free text describing the author's angle
- `tone`: professional, conversational, thought-leader, casual, analytical
- `topics`: list of topic keywords
- `profile_adherence_override`: low / medium / high

### 2. Personality Profile (user-editable via Settings)
- Stored in DB (`integration_config` table)
- Editable as plain text in the Settings page
- Injected into scoring, drafting, polishing, and alternate draft prompts
- Default generic profile provided for new users

### 3. Content Guardrails (user-editable via Settings)
- Strict rules that override all other style guidance
- Prevents AI-sounding patterns (no em dashes, no hype language)
- Injected first in every prompt (highest priority)

### 4. Feedback Learnings
- `post_feedback` table stores immutable performance data per post
- Token-budgeted to ~800 chars, prioritized by recency
- Great/good posts get full detail, average/poor get condensed
- Injected into scoring and draft prompts

### 5. Voice Snapshot (Short-term Memory)
- `voice_snapshot` field on `integration_config`
- Rolling summary of published positions from last 30 days
- Updated automatically after each publish
- Used by drift detection to flag contradictions

### 6. Personality Evolution (Long-term Learning)
- `personality_evolution_log` field on `integration_config`
- Triggered every 10 feedbacks
- Analyzes patterns in ratings, effective elements, improvement notes
- Suggests profile updates (hook types, structure, tone)
- Never overwrites core identity, only tunes the adaptive layer

## Scheduling Architecture

### Content Generation
- APScheduler CronTrigger at 8 PM the evening before posting day
- Drafts are ready for morning review

### Publish Queue
- APScheduler IntervalTrigger every 30 minutes
- Checks for `queued` status drafts in FIFO order
- Validates: campaign posting window active, global daily limit not exceeded, min gap met
- Publishes via LinkedIn UGC API, then updates voice snapshot

### Global Daily Post Limit
- Configured in Settings (`daily_post_budget`)
- Enforced across all campaigns
- Dashboard shows posts today / budget / remaining / queued count

## Database Schema (17 tables)
- `integration_config`: singleton settings + personality + voice memory
- `campaign`: multi-campaign definitions
- `daily_run`: pipeline execution records
- `source_signal`: fetched content signals
- `candidate_opportunity`: Claude-scored opportunities
- `selected_opportunity`: top N picks per run
- `draft`: generated LinkedIn posts with all versions
- `published_post`: LinkedIn publish records
- `approval_action`: approve/reject audit trail
- `post_feedback`: immutable performance feedback
- `token_usage`: LLM call tracking (tokens + cost)
- `personality_profile`: structured voice analysis (model exists, populated via settings)
- `historical_linkedin_artifact`: cached past posts
- `audit_event`: change log
- `secret_ref`: secret metadata (values in .env)
- `alembic_version`: migration tracking

## How personality.md Should Be Structured

For compatibility with this system, a personality profile should include:

### Voice Traits
- Writing style, sentence patterns, formality level
- Signature phrases, first-person preferences
- What to avoid (hype, fluff, generic AI cheerleading)

### Structure Preferences
- Preferred post length, hook styles, body structure, ending types
- Formatting: lists, bullets, hashtag/emoji usage

### Topic Affinities
- Primary and secondary topics with depth levels
- Topics to deprioritize or avoid

### Engagement Patterns
- Best-performing narrative types
- Success priority order (followers, comments, reposts)
- Posting frequency recommendations

### Tone Profile
- Provocative vs measured, personal vs professional
- Authority style, use of humor/vulnerability

## Tech Stack
- Backend: Python 3.11+ / FastAPI / SQLAlchemy / Alembic / APScheduler
- Frontend: Next.js 16 / React 19 / Tailwind CSS
- Database: SQLite (local) or PostgreSQL (Supabase)
- LLM: Anthropic Claude Sonnet with prompt caching
- Sources: 32 RSS feeds, Reddit JSON API, Hacker News Firebase API
- Content Extraction: trafilatura, scikit-learn (TF-IDF)
- Auth: LinkedIn OAuth 2.0
