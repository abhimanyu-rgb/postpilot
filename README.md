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
1. Source Fetching      RSS, Reddit, Hacker News --> 3500+ signals daily
2. TF-IDF Ranking       Filters to top 50 most relevant signals
3. Content Extraction   Trafilatura pulls full article text
4. AI Scoring           Claude scores opportunities by relevance + novelty
5. Draft Generation     Claude writes LinkedIn posts in your voice
6. Human Review         Edit, polish with AI, approve or reject
7. Scheduled Publish    Posts at your campaign's configured time slots
8. Feedback Loop        Your ratings improve future content
```

## Features

- **Multi-campaign support** with independent topics, personas, and posting schedules
- **Personality profile system** that learns your writing voice and enforces it
- **Content guardrails** to prevent AI-sounding patterns (no em dashes, no hype language)
- **Review queue** with inline editing, AI polish, and alternate post ideas
- **Media suggestions** sourced from original articles (OG images + links)
- **Token usage tracking** with weekly/monthly cost estimates
- **Publish queue** with FIFO ordering, campaign time windows, and global daily limits
- **Post feedback loop** that feeds performance data back into future content generation
- **LinkedIn OAuth** for secure publishing
- **Settings page** for self-serve configuration (no code changes needed)

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/settings/keys) (required)
- A [LinkedIn Developer App](https://www.linkedin.com/developers/apps) (optional, for auto-publishing)

### 1. Clone and configure

```bash
git clone https://github.com/your-username/postpilot.git
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

1. Go to the setup page, click **Validate Connections**
2. Configure your timezone and posting preferences
3. Go to **Settings > Writing Personality** and customize your voice profile
4. Create a campaign with your topics and persona
5. Trigger a run from the campaign detail page
6. Review drafts in the **Review Queue**

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
      models/           # SQLAlchemy data models
      schemas/          # Pydantic request/response schemas
      services/         # Business logic
        sources/        # Content source providers (RSS, Reddit, HN)
    frontend/
      src/
        app/            # Next.js pages and layouts
          (app)/        # Authenticated app pages
          setup/        # First-time setup wizard
        components/     # Reusable UI components
        hooks/          # React hooks
        lib/            # API client utilities
  migrations/           # Alembic database migrations
  scripts/              # CLI utilities
```

## Content Sources (Free, No API Keys)

| Source | Feeds | What it provides |
|--------|-------|-----------------|
| **RSS** | 32 feeds | TechCrunch, Wired, MIT Tech Review, Nature, HBR, arXiv, Stanford HAI, McKinsey, Stratechery, and more |
| **Reddit** | 16 topic categories | r/MachineLearning, r/startups, r/technology, r/datascience, and more |
| **Hacker News** | Top + Best stories | High-signal tech and startup content |

## Token Optimization

PostPilot minimizes Claude API costs through:

- **TF-IDF pre-ranking**: filters 3500+ signals to the top 50 before LLM scoring
- **Trafilatura extraction**: sends rich article content instead of thin summaries
- **Prompt caching**: system prompts are cached across calls
- **Token-budgeted feedback**: past post learnings are capped at ~800 tokens
- **Dashboard tracking**: monitor weekly/monthly token usage and estimated costs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy, Alembic |
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Database | SQLite (local) or PostgreSQL (Supabase) |
| LLM | Anthropic Claude Sonnet |
| Scheduling | APScheduler |
| Content Extraction | trafilatura, scikit-learn |
| Auth | LinkedIn OAuth 2.0 |

## Configuration

All configuration is done through the `.env` file and the Settings page in the app.

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
