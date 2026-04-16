<p align="center">
  <img src="app/frontend/public/logo.svg" width="64" height="64" alt="PostPilot logo" />
</p>

<h1 align="center">PostPilot</h1>

<p align="center">
  AI-powered LinkedIn content engine.<br/>
  Source trends. Generate drafts. Publish on autopilot.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue" alt="Python" />
  <img src="https://img.shields.io/badge/next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/claude-sonnet-orange" alt="Claude" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

PostPilot is a local-first LinkedIn content automation tool. It scrapes trending content from 32+ RSS feeds, Reddit, and Hacker News, uses Claude to identify opportunities and generate LinkedIn post drafts in your unique voice, and publishes them within your scheduled posting windows.

## How It Works

```
1. Source Fetching       RSS, Reddit, Hacker News --> 3500+ signals daily
2. TF-IDF Ranking        Filters to top 50 most relevant signals
3. Content Extraction    Trafilatura pulls full article text from URLs
4. AI Scoring            Claude scores opportunities (relevance + novelty)
5. Draft Generation      Claude writes LinkedIn posts in your voice
6. Voice Drift Check     Compares draft against your recent published positions
7. Human Review          Edit, polish with AI, approve or reject
8. Scheduled Publish     Posts within campaign time windows (FIFO queue)
9. Feedback Loop         Your ratings improve future content
10. Personality Evolution Feedback patterns update your voice profile over time
```

## Features

### Content Pipeline
- **Multi-campaign support** with independent topics, personas, posting schedules, and thresholds
- **32 RSS feeds** across tech, AI, business, academic, and industry sources
- **Reddit and Hacker News** providers with smart topic-to-subreddit mapping
- **TF-IDF pre-ranking** reduces 3500+ signals to the top 50 before LLM scoring
- **Trafilatura content extraction** enriches signals with full article text

### AI Intelligence
- **Claude-powered scoring** identifies 3-8 content opportunities per run
- **Claude-powered drafting** generates LinkedIn posts matching your voice
- **AI polish** rewrites drafts on demand with optional instructions
- **Content guardrails** prevent AI-sounding patterns (no em dashes, no hype language)
- **Prompt caching** reduces token costs on repeated system prompts

### Voice & Personality
- **Personality profile system** with editable voice, structure, and guardrail configs
- **Voice snapshot** maintains a rolling summary of your published positions
- **Drift detection** flags when a new draft contradicts recent public positions
- **Personality evolution** analyzes feedback patterns every 10 posts and suggests profile updates
- **Priority system**: guardrails > source content > feedback learnings > personality profile

### Review & Publishing
- **Review queue** with inline editing, AI polish, alternate post ideas, and media suggestions
- **Media sourcing** extracts OG images and article links from original sources
- **Scheduled publish queue** respects campaign time windows, min gap, and global daily limits
- **Post feedback** (immutable once submitted) feeds back into future content generation
- **Revert to review** if you approve or reject too quickly

### Dashboard & Management
- **Dashboard** with stats, publish queue status, recent runs, and token usage tracking
- **History page** with monthly grouping, collapsible months, multi-select, archive, and delete
- **Campaign management** with create, edit, activate, pause, archive, and delete
- **Settings page** with self-serve setup for LinkedIn OAuth, API keys, personality profile, and preferences
- **Animated splash screen** with Pixar-style logo flight and sound design

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/settings/keys) (required)
- A [LinkedIn Developer App](https://www.linkedin.com/developers/apps) (optional, for auto-publishing)

### 1. Clone and configure

```bash
git clone https://github.com/abhimanyu-rgb/postpilot.git
cd postpilot

cp .env.example .env
```

Edit `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 2. Install backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 3. Initialize database

```bash
alembic upgrade head
```

### 4. Install frontend

```bash
cd app/frontend
npm install
cd ../..
```

### 5. Start the app

In two terminals:

```bash
# Terminal 1: Backend
source .venv/bin/activate
uvicorn app.backend.main:app --reload --port 8000

# Terminal 2: Frontend
cd app/frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

### 6. First-time setup

1. Click **Get Started** on the splash screen
2. Validate your API key connection on the setup page
3. Configure timezone and posting preferences
4. Go to **Settings > Writing Personality** and customize your voice profile
5. Create a campaign, trigger a run, and review your first draft

## LinkedIn Publishing (Optional)

To enable auto-publishing to LinkedIn:

1. Create a [LinkedIn Developer App](https://www.linkedin.com/developers/apps)
2. Go to the **Auth** tab, copy your Client ID and Client Secret
3. Add the redirect URL: `http://localhost:8000/api/auth/linkedin/callback`
4. Request the **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** products
5. Add to your `.env`:
   ```
   LINKEDIN_CLIENT_ID=your-client-id
   LINKEDIN_CLIENT_SECRET=your-client-secret
   ```
6. Restart the backend, go to **Settings**, click **Connect LinkedIn**

## Project Structure

```
postpilot/
  app/
    backend/
      api/              # FastAPI route handlers
      core/             # Config, database, scheduler, storage
      models/           # SQLAlchemy data models (17 tables)
      schemas/          # Pydantic request/response schemas
      services/         # Business logic
        sources/        # Content source providers (RSS, Reddit, HN)
    frontend/
      src/
        app/            # Next.js pages and layouts
          (app)/        # Authenticated app (dashboard, campaigns, queue, history, settings)
          setup/        # First-time setup wizard
        components/     # Reusable UI components
        hooks/          # React hooks
        lib/            # API client utilities
  migrations/           # Alembic database migrations
  scripts/              # CLI utilities (set_secret.py)
```

## Content Sources (Free, No API Keys)

| Source | Coverage | What it provides |
|--------|----------|-----------------|
| **RSS** | 32 feeds | TechCrunch, Wired, MIT Tech Review, Nature, HBR, arXiv, Stanford HAI, McKinsey, Stratechery, and more |
| **Reddit** | 16 topic categories | r/MachineLearning, r/startups, r/technology, r/datascience, and more |
| **Hacker News** | Top + Best stories | High-signal tech and startup content |

## Token Optimization

PostPilot minimizes Claude API costs through:

- **TF-IDF pre-ranking**: filters 3500+ signals to the top 50 before LLM scoring
- **Trafilatura extraction**: sends rich article content instead of thin summaries
- **Prompt caching**: system prompts are cached across calls
- **Token-budgeted feedback**: past post learnings capped at ~800 tokens
- **Dashboard tracking**: monitor weekly/monthly token usage and estimated costs

## Voice Memory System

PostPilot maintains two layers of memory to keep your content coherent:

### Short-term: Voice Snapshot
After each publish, your last 30 days of posts are summarized into a compact snapshot of your public positions. New drafts are checked against this snapshot, and contradictions are flagged with severity badges (low/medium/high) in the review queue.

### Long-term: Personality Evolution
Every 10 feedbacks, patterns are analyzed and profile update suggestions are generated. This ensures your voice profile evolves naturally as your thinking evolves, without drifting from your core identity.

**Rule:** The adaptive layer may tune hook styles, structure preferences, and topic angles. But it never overwrites your core archetype, tone baseline, or identity guardrails.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy, Alembic |
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Database | SQLite (local) or PostgreSQL (Supabase) |
| LLM | Anthropic Claude Sonnet |
| Scheduling | APScheduler (content gen + publish queue) |
| Content Extraction | trafilatura, scikit-learn |
| Auth | LinkedIn OAuth 2.0 |

## Configuration

All configuration is through `.env` and the in-app Settings page.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `LINKEDIN_CLIENT_ID` | No | LinkedIn OAuth app client ID |
| `LINKEDIN_CLIENT_SECRET` | No | LinkedIn OAuth app client secret |
| `NEWS_API_KEY` | No | NewsAPI.org key (falls back to free RSS) |
| `DATABASE_URL` | No | Defaults to local SQLite |
| `TIMEZONE` | No | Defaults to UTC |

## License

MIT License. See [LICENSE](LICENSE) for details.
