# Migrating PostPilot to a new machine

Move a working PostPilot install to another laptop and keep your campaigns,
drafts, feedback, learned context, and OAuth tokens intact.

## What travels

| Item | Where it lives | In git? | Must copy? |
|---|---|---|---|
| Repo source | this directory | yes | `git clone` |
| Database | `data/app.db` | no (gitignored) | **yes** — carries campaigns, drafts, published posts, feedback, personality, learned context, token usage, published analytics |
| Environment secrets | `.env` (repo root) | no | **yes** — Anthropic API key + LinkedIn OAuth tokens |
| Draft snapshots | `data/drafts/` | no | optional — per-draft markdown history; app runs fine without them |
| Cached signals | `data/sources/` | no | optional — will regenerate on next run |
| Run logs | `data/logs/` | no | optional — historical only |

## Prerequisites on the new machine

- Python **≥ 3.11** (`pyproject.toml` requires `>=3.11`)
- Node **≥ 20**, npm
- git

## Step-by-step

**1. Clone the repo.**

```bash
git clone https://github.com/abhimanyu-rgb/postpilot.git
cd postpilot
```

**2. Copy the two things git doesn't carry.**

From the old machine (repo root), copy over:

```
data/app.db      →  <new-machine>/postpilot/data/app.db
.env             →  <new-machine>/postpilot/.env
```

Use `scp`, AirDrop, a USB stick, whatever — just don't commit them.

Optional (history / caches):

```
data/drafts/     →  <new-machine>/postpilot/data/drafts/
data/sources/    →  <new-machine>/postpilot/data/sources/
```

**3. Backend setup.**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
alembic upgrade head            # no-op if the DB is already at head — safe
```

**4. Frontend setup.**

```bash
cd app/frontend
npm install
cd ../..
```

**5. Launch.**

Two terminals, from the repo root:

```bash
# Terminal 1 — backend
source .venv/bin/activate
uvicorn app.backend.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd app/frontend
npm run dev                     # serves http://localhost:3000
```

Open **http://localhost:3000**. Your campaigns, queue, and analytics should
all be there.

## Gotchas

**LinkedIn OAuth callback URL.** Your LinkedIn developer app has
`http://localhost:8000/api/auth/linkedin/callback` registered as an authorized
redirect URL. That's machine-agnostic as long as the backend runs on port
8000 on the new machine too. If you copy `.env` with a live
`LINKEDIN_ACCESS_TOKEN`, publishing works immediately — no re-auth needed
until the 60-day token expires.

**If the LinkedIn token has expired**, visit
`http://localhost:8000/api/auth/linkedin` after launch to reconnect. Uses the
same `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` from `.env`.

**Frontend port collision.** If `:3000` is taken on the new machine
(some other app grabbing it), run `PORT=3002 npm run dev`. The backend
already allows `:3000`, `:3001`, and `:3002` in CORS.

**Anthropic API key.** Same key works from any machine — no binding.

**Backend persistence across sleep.** Not solved. Same as on the old
machine: `uvicorn` in a foreground terminal dies when the lid closes. The
scheduler (daily generation, publish queue, weekly analytics) only ticks
while the process is up.

## Verifying the migration

After launch, quick spot-checks:

- **http://localhost:3000/dashboard** — should show your KPIs from the old machine
- **http://localhost:3000/queue** — pending / approved / queued drafts intact
- **http://localhost:3000/analytics** — published posts and monthly insights
- **http://localhost:3000/settings** — LinkedIn shows Connected with your name

If any of those are empty, the DB copy didn't land — re-check the
`data/app.db` copy step.
