# Niyyah Vault Votes Dashboard — Design Spec (v2)

> Date: 2026-08-26
> Status: Approved
> Supersedes: `2026-08-14-vault-dashboard-design.md` (see §2 for why)
> Scope: Add a DB-backed, git-synced Votes dashboard to Niyyah, reflecting the xarvis Obsidian vault. Existing habit-tracker features (Non-Negotiables, Personas, Milestones, Principles, Schedule) are kept, untouched.

---

## 1. Purpose

Niyyah gains a second surface: a **Votes dashboard** that visualizes the daily "votes" tracked in the xarvis vault (7 life-area blocks scored 0-3 stars/day). It syncs from the vault's git history (not live filesystem reads) so history survives independent of any single machine having the vault mounted, and works whether the update comes from a vault push or a manual trigger.

This is additive. Niyyah's existing habit tracker (Non-Negotiables/Personas/Milestones/Principles/Schedule, per `PRD.md`) stays exactly as it is — nothing is deleted.

## 2. Why this supersedes the 2026-08-14 spec

A prior spec (`2026-08-14-vault-dashboard-design.md`, status Approved) proposed a different, incompatible design: no database (parse vault files fresh from local disk on every request via `VAULT_PATH`), no auth, dark-only theme, and — critically — **deleting** all of Niyyah's existing models/routes/auth/migrations to replace the app entirely with the vault dashboard.

That spec is superseded because:
- It assumed local-disk access to the vault from the API process. The approved sync design instead pulls from git (GitLab primary, GitHub fallback), so the dashboard works regardless of where the vault physically lives.
- It deleted the existing Non-Negotiables/Personas tracker. The user wants both to coexist.
- It specified dark-only theme. The user wants Datadog-style **light and dark** variants.

The old spec file is marked `Status: Superseded` (see end of this doc's changelog) and kept for history — no action needed on it beyond that header edit.

## 3. Architecture

```
xarvis vault (git: GitLab primary, GitHub mirror fallback)
        │ push
        ▼
GitLab webhook ──────────────┐
        │                    │
        ▼                    ▼
niyyah-api: POST /api/v1/vault/sync/webhook   POST /api/v1/vault/sync (manual, authenticated)
        │
        ▼
VaultSyncService:
  1. git pull (or clone if absent) into a local working dir inside the niyyah-api pod
     - try GitLab remote first
     - on failure (unreachable, auth error), fall back to GitHub mirror
  2. read Calendar/Daily/*.md
  3. parse each daily note (§5)
  4. upsert into Postgres: vault_days, vault_block_votes
        │
        ▼
Postgres (existing niyyah DB, shared-pg instance)
        │
        ▼
FastAPI read endpoints (§7) ──JSON──► Next.js dashboard page (§8)
```

- **In-process extension of niyyah-api** — no new service, no new deployment. New router, new models, new sync module inside the existing FastAPI app.
- **Vault is source of truth.** Dashboard is read-only from the user's perspective; all writes to vote data happen in Obsidian, not in Niyyah.
- **Sync triggers — both:**
  - GitLab webhook (Push event on the `pkm/xarvis` project) → `POST /api/v1/vault/sync/webhook`, validated by a shared-secret header (`X-Vault-Sync-Secret`), triggers an immediate sync.
  - Manual trigger → `POST /api/v1/vault/sync`, authenticated (same auth as rest of Niyyah API), for on-demand re-sync from the dashboard (e.g. a "Sync now" button) or a git post-push hook run locally.
- **Sync source — GitLab primary, GitHub fallback:** the sync service tries `ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git` first; if that clone/pull fails, it retries against `https://github.com/dark-knight-labs/xarvis.git`.
- Local vault working copy lives on a small PVC (or emptyDir — re-clone is cheap, vault is small) mounted into the niyyah-api pod, separate from the app's own repo checkout.

## 4. Data Model

New tables, same conventions as `app/models/tracker.py` (SQLAlchemy `Mapped`/`mapped_column`, `app.core.database.Base`). Single-user vault, no `user_id` FK needed (unlike `NonNegotiable`) — this is one person's vault.

```python
class VaultDay(Base):
    __tablename__ = "vault_days"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)       # full/yellow/compressed/minimal/off/ramadan/fasting
    possible: Mapped[int] = mapped_column(Integer, nullable=False)      # from modeMeta ceiling, NOT frontmatter (stale)
    total: Mapped[int] = mapped_column(Integer, nullable=False)         # sum of block_votes.stars for this day
    focus: Mapped[str | None] = mapped_column(Text, nullable=True)      # `## Focus` section, first line
    log: Mapped[str | None] = mapped_column(Text, nullable=True)        # `## Log` section, raw lines joined
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    block_votes: Mapped[list["VaultBlockVote"]] = relationship(back_populates="day", cascade="all, delete-orphan")


class VaultBlockVote(Base):
    __tablename__ = "vault_block_votes"
    __table_args__ = (UniqueConstraint("vault_day_id", "block"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_day_id: Mapped[int] = mapped_column(Integer, ForeignKey("vault_days.id"), nullable=False, index=True)
    block: Mapped[str] = mapped_column(String(20), nullable=False)   # soul/onething/ops/body/distribution/fnf/sleep
    stars: Mapped[int] = mapped_column(Integer, nullable=False)      # 0-3

    day: Mapped["VaultDay"] = relationship(back_populates="block_votes", foreign_keys=[vault_day_id])
```

Sync is idempotent: re-parsing a day and upserting by `date` (and by `(vault_day_id, block)` for votes) means re-runs never duplicate rows.

## 5. Vault Parsing Rules

Ground-truthed against the current daily note format (`Calendar/Daily/2026-08-23.md`), not the legacy `identify()`/`scoreDay()` heuristic in `Home.md`/`Assets/Data/Votes.md`, and not the `stars:`/`possible:` frontmatter fields (confirmed stale — grepped 10 recent daily notes, frontmatter `stars: 0` even when checkboxes were checked in the body).

**Block callouts, one block = one Obsidian callout with exactly 3 checkbox lines:**

```markdown
> [!soul]+ Soul
> - [x] ⭐ Prayed 5x Fard
> - [ ] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah
```

**Canonical block keys** (7 total): `soul`, `onething`, `ops`, `body`, `distribution`, `fnf`, `sleep`.

**Naming drift alias map** — older notes use different callout names for the same blocks; normalize on parse:
```
mind      → onething
operating → ops
```

**Parsing algorithm per day file:**
1. Find each `> [!<name>]+` callout start; normalize `<name>` via the alias map.
2. Within that callout's 3 checkbox lines, find the one `[x]` line; count its ⭐ characters (1-3). If none checked, `stars = 0`.
3. Record `(block, stars)` per block found. Missing blocks (inactive for the day's mode) are simply absent — not stored as 0 unless genuinely present and unchecked.

**Mode metadata** — hardcoded from the current daily template's `modeMeta` table (7 modes, not the old 3-mode green/yellow/red collapse used in the superseded spec). Verified from `Calendar/Daily/2026-08-23.md`:

| mode | possible (maxStars) | ceiling tier | color | inactive blocks |
|---|---|---|---|---|
| full | 21 | GREEN | `#10b981` | none |
| yellow | 14 | YELLOW | `#f59e0b` | none |
| compressed | 21 | GREEN | `#3b82f6` | none |
| minimal | 12 | GREEN | `#8b5cf6` | ONE Thing, OPS, Distribution |
| off | 2 | RED | `#ef4444` | ONE Thing, OPS, Body, Distribution, FnF |
| ramadan | 14 | YELLOW | `#06b6d4` | none |
| fasting | 21 | GREEN | `#f59e0b` | none |

Note: "inactive" blocks for a mode are the ones the daily note itself omits — the parser simply won't find those callouts on those days, which is consistent with §5's "missing blocks are absent, not stored as 0."

Implementation note: copy this table verbatim into `app/services/vault_parser.py` as a constant (`MODE_META`) — do not re-derive it from frontmatter, and re-sync this table if the daily template's `modeMeta` object ever changes.

**Other sections:**
- `## Focus` — first non-empty line after the heading.
- `## Log` — all `- ` lines after the heading until the next `##`.

## 6. Sync Service Behavior

- `app/services/vault_sync.py`: `sync_vault()` — pull/clone, iterate `Calendar/Daily/*.md`, parse (§5), upsert `VaultDay` + `VaultBlockVote`.
- Full re-sync each run (vault is small, parsing is cheap) — no incremental-diff complexity.
- Sync failures (git unreachable on both remotes, parse error on a malformed file) are logged and surfaced via the sync endpoint's response — never silent (per AGENT.md: "errors should never pass silently"). A bad single day's parse failure should not abort the whole sync; skip and report it.
- Webhook payload validated by shared-secret header only (no full GitLab HMAC signature verification needed for a homelab-internal, non-public endpoint) — consistent with "no public exposure" reasoning in the old spec, but the endpoint still requires the secret since it's reachable inside the cluster.

## 7. API Endpoints

New router `app/api/v1/vault.py`, mounted alongside the existing `tracker.py`/`dashboard.py` etc. All read endpoints query Postgres (not the filesystem).

- `GET /api/v1/vault/today` — today's `VaultDay` + block votes, total, pct.
- `GET /api/v1/vault/week` — last 7 days, per-day totals + per-block week totals.
- `GET /api/v1/vault/month?month=YYYY-MM` — all days in month, mode distribution.
- `GET /api/v1/vault/blocks?days=30` — per-block daily series for sparklines, plus averages.
- `GET /api/v1/vault/streaks` — current/longest streak per block (consecutive days with `stars > 0`).
- `POST /api/v1/vault/sync` — manual trigger, authenticated (existing Niyyah auth).
- `POST /api/v1/vault/sync/webhook` — GitLab webhook receiver, validated by `X-Vault-Sync-Secret` header, not user-authenticated.

Response shapes mirror the ones already drafted in the superseded spec §4 (they were fine — only the storage/sync layer underneath changes), e.g.:

```json
{
  "date": "2026-08-26",
  "mode": "full",
  "possible": 21,
  "blocks": { "soul": 2, "onething": 3, "ops": 1, "body": 3, "fnf": 1, "distribution": 2, "sleep": 2 },
  "total": 14,
  "pct": 67,
  "focus": "...",
  "log": ["- entry 1"]
}
```

## 8. Web Dashboard

New route in the existing Next.js app (e.g. `apps/web/src/app/(app)/vault/page.tsx`), linked from nav alongside the existing Non-Negotiables/dashboard pages — not a full app replacement.

**Scope — Votes only, v1.** Explicitly excluded from this dashboard (deferred to phase 2): Efforts panel (On/Ongoing/Simmering), Doctrine KR panel. These are separate xarvis subsystems the user confirmed are out of scope for now.

**Sections** (same six as the superseded spec's §5, kept — they were sound):
1. Header — mode badge, today's score (`14/21 · 67%`), last sync time + manual "Sync now" button (calls `POST /api/v1/vault/sync`).
2. Today's Blocks — 7-card grid, block name colored, star dots, star count.
3. Weekly Pulse — 7-day bar chart, bar height = score %, color by mode.
4. Monthly Heatmap — grid of day-circles, fill intensity by score %.
5. Block Trends — 30-day sparklines per block.
6. Footer Stats — mode distribution (stacked bar) + streaks per block.

**Theme — Datadog-style, light AND dark variants**, toggled by Niyyah's existing theme setting (extends the current light/dark toggle rather than adding a third mode). Datadog visual language:
- Dense, bordered cards with tight padding.
- Monospace font for stat numbers (score counts, percentages, streak numbers) — pair with existing Manrope for labels/prose.
- Uppercase, small-caps section/label text.
- Purple/violet accent as the primary brand color for this page, distinct per-block colors for the 7 blocks (reuse the palette from the superseded spec §5 Design Tokens as a starting point — Soul emerald, ONE Thing blue, OPS violet, Body amber, FnF rose, Distribution cyan, Sleep slate — since those don't conflict with anything and were already well-chosen).
- Light variant: light gray/white surface, dark text, same accent hues at adjusted saturation/lightness for contrast.
- Dark variant: near-black surface (values from superseded spec §5 are reusable: bg `#0a0a0a`, surface `#141414`, border `#262626`, text `#fafafa`/`#a1a1aa`/`#52525b`).

No charting library — pure CSS (flexbox bars, circle grids, sparkline bars), per superseded spec §5 — this part of the old design was sound and is kept.

## 9. What's Kept (explicitly, in contrast to the superseded spec)

- All existing `apps/api/app/models/`, `app/api/v1/*.py` (auth, dashboard, personas, principles, schedule, settings, tracker), `app/core/*` (auth, security, database config), `alembic/` migrations.
- All existing `apps/web` pages under `(app)/` and `(auth)/`, existing components, Zustand stores, hooks.
- `packages/shared-types/`.
- Existing tests.

Nothing here is deleted or rewritten. This spec is purely additive: 2 new tables, 1 new migration, 1 new router, 1 new service module, 1 new frontend route + its components.

## 10. Out of Scope (v1)

- Efforts panel (On/Ongoing/Simmering) — phase 2.
- Doctrine/Constitution KR panel — phase 2.
- Write operations from the dashboard back into the vault.
- Weekly review note parsing (`Calendar/Weekly/`).
- Auth changes — reuses existing Niyyah auth as-is.
- Drill-down day-detail view (click a day to expand) — future v2+.
- Real-time updates (websockets) — dashboard reflects state as of last sync; manual "Sync now" covers the interim.

## 11. Environment Variables / Secrets

```
VAULT_GITLAB_URL=ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git
VAULT_GITHUB_URL=https://github.com/dark-knight-labs/xarvis.git
VAULT_SYNC_SECRET=<shared secret for webhook header validation>
VAULT_WORKDIR=/data/vault-sync   # local clone path inside the pod
```

SSH key for the GitLab clone: reuse an existing deploy-key pattern from other homelab git-over-SSH integrations (see `infra.md` for the gitlab-mirror key convention) — a read-only deploy key scoped to `pkm/xarvis`, not a personal key.

## 12. Rollout Plan

1. Migration: add `vault_days` + `vault_block_votes` tables (new alembic revision, additive only — no changes to existing tables).
2. Add `vault_parser.py` + `vault_sync.py` services, unit-test the parser against real daily note fixtures (including alias-drift cases).
3. Add `vault.py` router, wire into `main.py`.
4. Add GitLab webhook on `pkm/xarvis` project → niyyah-api's sync endpoint (through existing ingress).
5. Add frontend `/vault` route + components + Datadog theme tokens.
6. Manual first sync (`POST /api/v1/vault/sync`) to backfill history from existing `Calendar/Daily/*.md`.
7. Verify dashboard against known-good days (spot check a few dates against the in-vault `Assets/Data/Votes.md` numbers).

---

## Changelog

- 2026-08-26: v2 written, supersedes 2026-08-14 spec (see §2). Old spec's `Status:` header updated to `Superseded`.
