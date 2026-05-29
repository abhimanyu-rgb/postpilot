# PostPilot — Business Requirements Document

_Last updated: 2026-05-27_

## 1. Purpose

PostPilot is a local-first, AI-assisted LinkedIn content engine for a single thought-leader user. It generates campaign-driven post drafts, runs them through a human review queue, publishes on a schedule, scrapes public engagement weekly, and uses the engagement signal to evolve the system's voice and prompt context over time.

It is currently used by one user (the developer) on a single MacBook. Architecture supports multi-user deployment but no auth or tenancy boundaries exist yet.

## 2. Users & roles

Single user wears all hats:

- **Creator** — defines campaigns, persona, voice, guardrails
- **Reviewer** — approves/rejects drafts in the queue, edits text
- **Learner** — promotes engagement-derived insights into learned context

No multi-user permissions, sharing, or workspace concepts.

## 3. Core domain objects

| Object | What it is |
|---|---|
| **Campaign** | A standing brief: topics, persona, tone, frequency, posting window, source preferences, optional per-campaign prompt injection (prioritize / avoid / archetypes). |
| **Daily Run** | One execution of the content pipeline for one campaign, on one date. Unique by `(campaign_id, date)`. |
| **Source Signal** | A raw ingested item — RSS article, Reddit post, Hacker News story. Deduped by content hash. |
| **Candidate Opportunity** | A scored content angle generated from one or more signals, scoped to a campaign. |
| **Selected Opportunity** | The top-N candidates chosen for drafting. Cross-campaign source-hash deduplication prevents the same article driving multiple campaigns within 14 days. |
| **Draft** | A generated LinkedIn post body with status (pending_review / approved / queued / published / rejected / archived). Also covers user-drafted posts via "Write a Post" — those have `selected_opportunity_id = 0`. |
| **Published Post** | A draft that went live to LinkedIn, with the share URN and (optionally) activity URN stored. |
| **Post Feedback** | Manual user feedback per draft — rating, what worked, what didn't, effective elements, improvement notes. |
| **Post Analytics** | Append-only engagement snapshots per draft per scrape (reactions, engagement_score). |
| **Staged Insight** | Claude-extracted "what worked" insight from a top-quartile post, awaiting human gate before promotion to learned_context. |
| **Integration Config** | Single-row settings table: timezone, daily post budget, min gap between posts, max active campaigns, LinkedIn profile handle, personality prompt, content guardrails, learned context, voice snapshot, evolution thresholds. |

## 4. Functional requirements

### 4.1 Content generation pipeline

- Runs daily at 16:00 user-local for every active campaign (was 20:00, moved earlier because laptop was off at 20:00).
- Misfire grace of 3 hours; runs missed beyond that fall to the next day.
- Pipeline steps: fetch source signals → TF-IDF prefilter → Claude scoring → cross-campaign dedup → select → draft generation.
- Hard cap of `max_active_campaigns` campaigns in active status simultaneously (default 3, user-configurable).

### 4.2 Draft generation prompt composition

System prompt is layered by priority:

1. Content guardrails (global, strict)
2. Source content (factual grounding)
3. Campaign-specific instructions (prioritize / avoid / archetypes from the campaign)
4. Manual feedback context (from `post_feedback`)
5. Learned context (engagement-derived insights, promoted by user)
6. Personality profile (voice + style)

Every campaign-driven and user-drafted post passes through these layers.

### 4.3 Write-a-Post (manual draft entry)

User types a topic + notes, optionally enriches with recent source signals, picks a posting window. Goes through the same review queue.

### 4.4 Review queue

- All non-terminal drafts are listed at `/queue`.
- Inline edit with autosave-on-approve.
- Polish via Claude with optional instructions.
- Approve → enters publish queue (status=queued).
- Reject → terminal.
- Only `published` is truly terminal; any other status can revert back to `pending_review`. This was a deliberate design choice after the boiling-frog incident.

### 4.5 Publish queue

- Background processor runs every 30 minutes.
- Publishes one draft at a time in FIFO order, respecting:
  - Daily post budget (configurable, default 1)
  - Minimum gap between posts (configurable, default 180 min)
  - Campaign or draft-specific posting window
- Uses LinkedIn UGC Post API via stored OAuth token.

### 4.6 Cross-campaign source dedup

At selection time, candidates whose source signals were used by any non-rejected draft in the last 14 days are suppressed. Same article cannot drive multiple campaigns within the cooldown.

### 4.7 Voice memory (short-term)

- After every publish, `voice_snapshot` is rebuilt from the last 30 days of published posts.
- Each post annotated with its latest reaction count from analytics; high-performers explicitly tagged so the summary privileges what resonated.
- Used at draft time for drift detection — Claude flags if a new draft contradicts a recent published position.

### 4.8 Personality evolution (long-term)

- Periodic Claude analysis of feedback + engagement patterns to suggest personality profile updates.
- Dual-trigger: fires when EITHER `>= evolution_min_feedbacks` manual ratings OR `>= evolution_min_snapshots` analytics rows (both configurable, defaults 5 and 4).
- Reconciliation rules:
  - Both signals agree → high confidence suggestion.
  - Only feedback supports → medium.
  - Only engagement supports → low; require strong pattern.
  - Signals conflict → flag, do NOT suggest.
- Suggestions always staged for user review; never silently overwrite personality.

### 4.9 Weekly engagement analytics

- Saturday 09:00 user-local + on-demand from Analytics tab.
- Cohort: posts published 7–14 days ago (lag window to let engagement mature).
- Scrapes `https://in.linkedin.com/in/<handle>` public profile via headless Playwright. Reactions captured; comments and reposts are not publicly visible (LinkedIn limitation, after we tried and abandoned the auth-cookie path).
- Matches scraped activity URN to stored share URN via numeric proximity (proven robust to ~10^11 threshold).
- Append-only snapshots, so growth over time is preserved.

### 4.10 Insight extraction & promotion

- After each refresh, drafts whose latest engagement_score is ≥ the relative threshold (top quartile over the last 90 days) get a Claude-generated insight describing what made the post work.
- Backfill sweep covers posts whose first qualifying snapshot pre-dated the threshold becoming computable.
- Insights are staged with `status=pending`. User reviews on Analytics tab, clicks "Add to learned context" (promote) or "Dismiss" (reject).
- Promoted insights append to `integration_config.learned_context`, which is then injected into all future drafts via the prompt's tier 5.

### 4.11 Analytics tab UI

- Week-grouped, expandable rows (Mon–Sun, newest first).
- Per-row markers: `Top quartile` (engagement score ≥ threshold), `Insight applied` (a promoted insight exists for this draft), `Manual feedback` (rating recorded).
- Pending insights surface as a yellow review banner above the table.
- Staleness indicator on last-refresh timestamp.

### 4.12 Settings

View-mode by default, explicit Edit to unlock, for all sections:

- Integrations (read-only, secrets in `.env`)
- Posting Preferences (timezone, daily budget, min gap, max active campaigns, LinkedIn profile handle)
- Memory & Learning (evolution thresholds)
- Writing Personality (author name, voice prompt, guardrails)
- Learned Context (auto-populated, user-editable)

### 4.13 Setup wizard

First-run flow at `/setup`: validate Anthropic key, LinkedIn OAuth, optional Slack, then account settings (timezone, budget, gap, LinkedIn handle).

## 5. Non-functional requirements

### 5.1 Local-only deployment

Runs entirely on the user's machine — FastAPI backend on port 8000, Next.js frontend on port 3000, SQLite at `data/app.db`. No remote services other than outbound API calls.

**Implication actively impacting users:** scheduled jobs only fire when the laptop is on and the backend process is alive. Misfire grace covers a few hours; longer outages mean missed runs. This has bitten the user multiple times.

### 5.2 Single source of truth for paths

`DATABASE_URL` resolves to an absolute path against the repo root regardless of working directory. Stale-DB-divergence bug was patched.

### 5.3 Secrets handling

`.env` gitignored, not tracked. Frontend `/api/setup/env-config` returns only `{set: bool, preview: "first4****last4"}` — never raw values. Public repo on GitHub.

### 5.4 Idempotency

- Daily run unique by `(campaign_id, date)`.
- Analytics scrape skips drafts already scraped today.
- Insight backfill skips drafts that already have any staged_insight (pending / promoted / rejected).

### 5.5 Observability

Structured logs to `data/logs/app.log`. Token usage tracked per Claude call via `token_tracker`. APScheduler misfire warnings logged.

## 6. Out of scope / known limitations

1. **Multi-user.** No auth, no tenancy. Single SQLite row in `integration_config`.
2. **Always-on scheduling.** Cron only fires when laptop is on. No queue-based "catch up since last seen" — APScheduler drops missed jobs past misfire grace.
3. **LinkedIn engagement depth.** Public scrape captures reactions only. Comments, reposts, reaction-type breakdown require authenticated scraping, which LinkedIn anti-bot blocks from a fresh IP. Tried multi-cookie path, abandoned.
4. **No automated promotion of insights.** Human gate is mandatory by design.
5. **No retry/dead-letter for LinkedIn publish failures.** If the API rejects, the draft is marked `publish_failed`; user has to revert and re-queue.
6. **No analytics for engagement trajectory.** Snapshots are append-only but the UI shows only the latest reading per post.
7. **API key health.** Anthropic key invalidation silently breaks generation and voice updates; only surfaced in logs.

## 7. Key product decisions worth knowing

- **"Only `published` is terminal."** Everything else can be reverted, including approved and queued. Lets the user iterate on a draft without state drift between UI and backend.
- **Relative engagement threshold, not absolute.** Top quartile over rolling 90 days self-tunes per user. Avoids cargo-culting numbers that don't generalize.
- **Manual feedback is gold, engagement is supporting.** Wherever both signals feed Claude, manual feedback is weighted higher and conflicts are flagged rather than auto-resolved.
- **Human gate on personality-touching changes.** Insight extraction is automated, but promotion to `learned_context` and personality-evolution suggestions are both staged.
- **One config table per user.** Settings, thresholds, voice snapshot, and learned context all live on `integration_config` (single row, id=1). Multi-user would mean moving to per-user rows; not done.

## 8. Current data shape (snapshot at last update)

- 5 active campaigns
- ~40 drafts across all statuses; 9 publicly scraped engagement snapshots
- 3 pending staged insights (most recent backfill batch)
- `learned_context` empty (no insights promoted yet)
- Personality evolution log empty (thresholds not yet crossed)
