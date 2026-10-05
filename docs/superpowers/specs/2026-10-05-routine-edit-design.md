# Routine edit: mode, votes and notes written into the daily note - design

Date: 2026-10-05. The vault stays the single source of truth; Niyyah writes back into it.

## What
When signed in as the owner, /routine shows an Edit button. A side panel sets today's Mode, gives the seven block votes (0-3 stars) and adds a note to a part of the day. After Isha the ring's centre shows the sleep block's own mode (default "Reads books to sleep") instead of the day mode.

## How it is saved
- API: `PUT /vault/day/{date}/mode`, `PUT /vault/day/{date}/vote`, `POST /vault/day/{date}/notes`, `GET /vault/edit-access`.
- `services/vault_write.py`: pure text edits of `Calendar/Daily/<date>.md` (mode line, the checkbox line for the chosen star level, a bullet under `## Log`). A missing day is created by copying the layout of the latest note (Today's Shape block kept, votes and log cleared).
- `services/vault_git.py`: under a file lock, `fetch` + `reset --hard origin/main`, re-apply the edit to fresh content, commit, `push origin HEAD:main`. A rejected push (Obsidian Git pushed first) restarts the attempt, up to 3 times, so edits never merge-conflict. The checkout is a mirror, so the reset discards nothing.
- After a push the API re-syncs the DB so /vault/today reflects it immediately.

## Access
- Registration is open, so writing is owner-only: `VAULT_WRITE_EMAILS` (comma list; empty = nobody). Others get 403 and no Edit button.
- Only the last 7 days can be edited. Mode and block names are validated; notes are one line, max 500 characters.
- The vault deploy key needs push permission (`can_push` on the GitLab deploy key). Revoke it to make the app read-only again.

## Not done
The GitHub mirror only receives these commits on the next push from the laptop (the API pushes to GitLab only).
