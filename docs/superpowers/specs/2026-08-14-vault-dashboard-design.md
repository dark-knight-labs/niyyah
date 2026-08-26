# Niyyah Vault Dashboard — Design Spec

> Date: 2026-08-14
> Status: Superseded — see `2026-08-26-vault-votes-dashboard-design.md`
> Scope: Replace niyyah habit tracker with a read-only vault dashboard for xarvis

> **Superseded 2026-08-26.** This spec deleted the existing habit tracker and used a
> stateless/no-DB direct-filesystem read. The new spec keeps the existing tracker,
> adds a DB-backed dashboard synced from git (GitLab primary, GitHub fallback), and
> uses a Datadog-style light+dark theme instead of dark-only. Kept here for history.

---

## 1. Purpose

Niyyah becomes a **read-only dashboard** that visualizes data from the xarvis Obsidian vault. No database. No auth. The vault IS the database. The dashboard runs on the burak homelab for personal use.

## 2. Architecture

```
xarvis vault (markdown files on disk)
        ↓ reads
FastAPI (apps/api) — parses .md files, extracts votes/modes/logs
        ↓ JSON
Next.js (apps/web) — renders single-page dashboard
```

- **No database.** No SQLite, no Postgres, no migrations.
- **No auth.** Homelab-only, not public.
- **Stateless API.** Every request parses fresh from disk. Daily notes are small (<10KB each), parsing is fast.
- **Vault path** via env var: `VAULT_PATH=/home/ubuntu/src/dark-knight/xarvis`

## 3. Vault Data Model

### Daily Note Structure

Location: `Calendar/Daily/YYYY-MM-DD.md` (current) or `Daily/YYYY-MM-DD.md` (legacy)

**Frontmatter fields:**
- `mode`: `green` | `yellow` | `red` (legacy: `full`, `compressed`, `minimal`, `off`, `fasting`, `ramadan`)
- `created`: date string
- `type`: `daily`

**Vote blocks** — identified by Obsidian callout type:

```markdown
> [!soul]+ Soul
> - [x] ⭐ Prayed 5x Fard
> - [ ] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah
```

Seven blocks: `soul`, `onething`, `ops`, `body`, `distribution`, `fnf`, `sleep`

**Parsing rules:**
- Find lines matching `> [!<block>]+` to identify block start
- Within block, find checked items `[x]` containing ⭐
- Count stars (⭐ = 1, ⭐⭐ = 2, ⭐⭐⭐ = 3)
- Take the highest checked star level per block

**Mode normalization** (backward compat):
- `full`, `green`, unset → `green` (possible: 21)
- `compressed`, `yellow`, `fasting`, `ramadan` → `yellow` (possible: 14)
- `minimal`, `off`, `red` → `red` (possible: 7)

**Other sections:**
- `## Focus` — extract first line after heading
- `## Log` — extract all `- ` lines after heading until next `##`

### Weekly Review Structure

Location: `Calendar/Weekly/YYYY-WNN.md`

Not parsed in v1 — weekly data is computed from daily notes.

## 4. API Endpoints

All endpoints return JSON. No pagination needed (vault is small).

### `GET /api/today`

```json
{
  "date": "2026-08-14",
  "mode": "green",
  "possible": 21,
  "blocks": {
    "soul": 2, "onething": 3, "ops": 1,
    "body": 3, "fnf": 1, "distribution": 2, "sleep": 2
  },
  "total": 14,
  "pct": 67,
  "focus": "Most important thing today: ...",
  "log": ["- entry 1", "- entry 2"]
}
```

### `GET /api/week`

Returns last 7 days ordered by date.

```json
{
  "days": [
    {
      "date": "2026-08-08",
      "dow": "Sat",
      "mode": "green",
      "possible": 21,
      "blocks": { "soul": 2, ... },
      "total": 14,
      "pct": 67
    },
    ...
  ],
  "totals": {
    "soul": 9, "onething": 12, ...
  },
  "week_total": 79,
  "week_possible": 147,
  "week_pct": 54
}
```

### `GET /api/month?month=2026-08`

Returns all days in the given month. Same day structure as week endpoint.

```json
{
  "month": "2026-08",
  "days": [...],
  "totals": { ... },
  "modes": { "green": 10, "yellow": 3, "red": 1 },
  "month_pct": 54
}
```

### `GET /api/blocks?days=30`

Returns per-block daily scores for the last N days. For sparklines.

```json
{
  "range": 30,
  "blocks": {
    "soul": [1, 2, 1, 0, 2, ...],
    "body": [3, 3, 3, 1, 1, ...],
    ...
  },
  "averages": {
    "soul": 1.5, "body": 2.3, ...
  }
}
```

### `GET /api/streaks`

Current and longest streak per block (consecutive days with score > 0).

```json
{
  "soul":   { "current": 5, "longest": 12 },
  "body":   { "current": 8, "longest": 8 },
  ...
}
```

## 5. Web Dashboard — Single Page

### Layout

Dark theme. Six sections stacked vertically. Mobile-first, works on desktop.

#### Section 1: Header

- App name "NIYYAH" (left)
- Today's mode badge (colored pill: green/yellow/red)
- Today's score: `14/21 · 67%`
- Last sync time + refresh button

#### Section 2: Today's Blocks (7 cards in a grid)

- 7 cards in a responsive grid (7 cols desktop, 4+3 mobile)
- Each card: block name (colored), star dots (filled/empty circles), star count
- Card background tinted with block color at low opacity when scored > 0
- Empty/zero blocks show as muted

#### Section 3: Weekly Pulse (7-day bar chart)

- 7 vertical bars, one per day
- Bar height = score percentage
- Bar color = mode color (green/yellow/red gradient by score %)
- Day label below (Mon, Tue, ...)
- Today's bar has a subtle ring/highlight
- Week average shown as a horizontal reference line

#### Section 4: Monthly Heatmap

- Grid of circles, one per day of the month
- Fill color intensity based on score % (empty/red/orange/yellow/green spectrum)
- Future days shown as dashed outlines
- Clickable days (future: expand to show detail)

#### Section 5: Block Trends (30-day sparklines)

- 7 rows, one per block
- Each row: block name (colored) | sparkline (CSS-only, 30 thin bars) | average score
- Sparkline bar height proportional to daily score (0-3)
- Bar color matches block color

#### Section 6: Footer Stats

Two side-by-side cards:

**Mode Distribution:**
- Stacked horizontal bar (green/yellow/red segments)
- Count labels: "12G · 3Y · 1R"
- Month and year rows

**Streaks:**
- Per-block current streak with small flame icon if streak > 7
- Show current / longest

### Design Tokens

```
Background:     #0a0a0a
Surface:        #141414
Surface-hover:  #1a1a1a
Border:         #262626
Text-primary:   #fafafa
Text-secondary: #a1a1aa
Text-muted:     #52525b

Soul:           #10b981
ONE Thing:      #3b82f6
OPS:            #8b5cf6
Body:           #f59e0b
FnF:            #f43f5e
Distribution:   #06b6d4
Sleep:          #64748b

Mode-green:     #059669
Mode-yellow:    #eab308
Mode-red:       #ef4444
```

Font: Manrope Variable (already installed). Weights: 400, 500, 600, 700.

### No Charts Library

All visualizations built with CSS:
- Bar charts: flexbox with percentage heights
- Heatmap: grid of colored circles
- Sparklines: inline flexbox with thin bars
- Progress bars: CSS width percentages

## 6. What Gets Deleted

From `apps/api/`:
- `app/models/` — all SQLAlchemy models
- `app/api/` — all existing route handlers
- `app/schemas/` — all Pydantic schemas
- `app/services/` — all existing services
- `app/core/` — auth, security, database config
- `alembic/` — all migrations
- `alembic.ini`
- `test.db`
- Tests (rewrite for new endpoints)

From `apps/web/`:
- All pages under `(app)/` and `(auth)/`
- All existing components
- Zustand stores
- Hooks

From `packages/`:
- `shared-types/` — old type definitions

## 7. What Gets Kept

- Monorepo structure (turbo.json, package.json, apps/web, apps/api)
- Next.js 16 + Tailwind 4 + Radix primitives setup
- FastAPI shell (main.py structure)
- Docker files + k8s manifests (updated for new env vars)
- packages/ui (button, spinner)
- CI config (.gitlab-ci.yml)
- Manrope font setup

## 8. New File Structure

```
apps/api/
  app/
    main.py              — FastAPI app, CORS, mount routers
    config.py            — VAULT_PATH from env
    parser.py            — markdown parser (extract votes, mode, log, focus)
    routers/
      today.py           — GET /api/today
      week.py            — GET /api/week
      month.py           — GET /api/month
      blocks.py          — GET /api/blocks
      streaks.py         — GET /api/streaks
  tests/
    test_parser.py       — parser unit tests
    test_endpoints.py    — endpoint integration tests
  requirements.txt       — fastapi, uvicorn, python-frontmatter, pyyaml

apps/web/
  src/
    app/
      layout.tsx         — dark theme, Manrope font
      page.tsx           — dashboard (single page)
      globals.css        — dark theme tokens, utilities
    components/
      header.tsx         — mode badge, score, refresh
      block-cards.tsx    — 7-block grid
      weekly-pulse.tsx   — 7-day bar chart
      monthly-heatmap.tsx — day circles grid
      block-trends.tsx   — sparklines
      footer-stats.tsx   — modes + streaks
    lib/
      api.ts             — fetch helpers
      types.ts           — TypeScript interfaces for API responses
      constants.ts       — block colors, names, order
```

## 9. Environment Variables

```
VAULT_PATH=/home/ubuntu/src/dark-knight/xarvis    # path to xarvis vault
API_URL=http://localhost:8000                       # API base URL (for web)
```

## 10. Out of Scope (v1)

- Auth / multi-user
- Write operations (editing vault from dashboard)
- Weekly review display
- Doctrine/Constitution display
- Push notifications
- PWA / offline
- Real-time updates (websockets)
- Drill-down day detail view (future: click a day to expand)

These are all valid v2+ features. Ship the read-only dashboard first.
