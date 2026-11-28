# Niyyah Capture (menu-bar app)

A macOS menu-bar app with two parts. Bundle id `bd.burak.niyyah.menubar`, shown as "Niyyah Capture".

- **Quick capture:** press **Option+Command+N**, type, press Enter. The task goes to Niyyah.
- **Focus panel** (ported from [Next Up](https://github.com/alamin-mahamud/nextup)): a task list that opens as a popup under the
  menu-bar icon with a timer per task, deadlines, links, check-in flashes, window-switch reminders,
  dictation and global shortcuts. Every task you add there is also filed in Niyyah.

Stack: Tauri 2. `core/` is plain Rust (queue, API client, token store) and is tested on Linux;
`src-tauri/` is the thin shell (tray icon, global shortcut, popover); `ui/` is the web layer
(plain HTML/CSS/JS, no build step, no remote scripts or styles). The focus panel is derived from Next Up
(owner decision 2026-11-28: copy freely, take every feature). Its updater and its release workflow are **not** ported.

## Focus panel: Next Up features and where they live

| Feature | Where |
|---|---|
| Task list: name, done, deadline, link; drag to reorder; edit from the right-click menu | `ui/panel.js`, `ui/panel.html` |
| Per-task timer (`trackedMs`, `startedAt`), awake time only (sleep and display-off excluded) | `ui/tasklogic.js`, `core/src/awake.rs`, `src-tauri/src/awake_clock.rs` |
| Deadlines, highlighted in the last 3 hours | `ui/tasklogic.js` |
| Open a task link (http/https, no credentials, checked in JS and again in Rust) | `core/src/link.rs`, `widget.rs` |
| Check-in flash and shake every N minutes (1 to 60, or off) | `ui/panel.js`, `widget.rs` (`schedule_checkin`) |
| Window-switch reminder: task name flashes over the screen | `focus_switch.rs`, `core/src/focus.rs`, `ui/reminder.*` |
| Browser-tab reminder (Chrome or Safari, via AppleScript) | `focus_switch/browser.rs`; pick the browser in Settings |
| Dictation (speech recognition of the webview) and bulk "one priority per line" | `ui/panel.js` |
| Global shortcuts (previous, next, new task, pause), rebindable | `widget.rs` (`set_task_shortcut`) |
| Tray menu: Capture, Show tasks, Settings, Quit | `main.rs` |
| Settings window: Always on Top, app size, check-in, shake, reminders, shortcuts, Niyyah connection | `ui/panel.html` |
| Local `tasks.json`, atomic writes, mode 0600 | `core/src/taskstore.rs` |
| Offline queue for the Niyyah side | `core/src/queue.rs` (below) |
| Software updater | **removed** (no endpoint, no plugin) |

## Focus window and the menu bar

**Focus window.** In the panel, **Focus** opens a picker of the open windows (app and title). Pick one, choose
count-up or a countdown (1 to 240 minutes) and Start: the timer is tied to the current task (it starts the
task if it is not running). If you leave the window for about 1.5 seconds the panel chip turns amber
("Away from Safari"), a full-screen reminder says "Back to Safari" and the menu-bar text changes to
"Away · 12:34 · Task". If the window or app is closed the chip turns red ("window closed"). Cmd-Tab and back
within that grace time is not counted, and switching to Niyyah Capture itself (to pause the timer) never counts.
The chosen window and the running session are saved (`focus.json`) and resume after a restart. Every finished
session is appended to `sessions.jsonl` as one line: `task_id`, `client_id`, `task`, `app`, `window`, `mode`,
`started_at`, `ended_at`, `duration_ms`, `away_ms`, `away_count`, `completed`. That file is what will sync to
Niyyah once the backend has timer fields. Both files are owner-only (0600).

Permissions, least first: the front app and the list of running apps need none. **Window titles need
Accessibility** (AXUIElement); the picker's "Allow window titles" button triggers the system prompt. Without it,
focus works for the whole app. **Screen Recording is never needed** (titles are not read through CGWindowList).
Automation is separate and only for the browser-tab reminder.

**Menu bar.** The app lives in the menu bar only (no Dock icon). Click the ring: the Next Up style panel opens as
a popup right under the icon and closes when you click elsewhere or press Esc (unless you tick "Stay open when I
click elsewhere" in Settings). Option+Command+N opens the quick-capture popover instead.

**Switch-away alert (what "leaving the window" does).** While a focus session runs, leaving the chosen window
makes the tray icon **blink amber** until you return or end the session; the popup shakes if it is open; the
chip turns amber; and a full-screen "Back to Safari" names the window to return to. With macOS **Reduce Motion**
on, the icon stays steadily amber and the popup does not shake. The same blink (8 s) is used for the timed
check-in when the popup is closed.

Native vs custom: the tray icon (a monochrome template image, so macOS tints it; amber, coloured, while
alerting) and its dropdown menu (Capture, Show tasks, Settings, Quit) are the **native** macOS menu; Tauri cannot
style them, and Next Up itself uses a native menu. The text next to the icon (running timer and task) is native
too, in the system font. The popup and every dialog are the custom Next Up design, anchored under the icon.

**Window names stay on this Mac.** The chosen window's app and title live only in `focus.json` and
`sessions.jsonl` in the app data folder. They are never part of a capture: `Capture` has no field for them and a
test (`local_only_fields_never_reach_the_wire`) pins that none of window, title, app, bundle id, link, deadline,
timer or client id reaches the server body.

## Blocks and products

The block picker shows the plan page's tiles (SOUL, BODY, ONE, OPS, PLAN, DIST, FNF, SLEEP: white tiles in a
pale-blue column, monospace caps). Picking a block fills the product chips from that block's products; the
lane defaults to **NOW** (NOW, NEXT, BACKLOG). `GET /api/v1/capture/options` is read tolerantly in two shapes:
planner blocks (`key`, `ring_name`, `label`, `color`, `products`) and the first server version's schedule rows
(`block`, `start`, `end`, `what`, `stream`, with top-level `products` tied by `block`). A reply that matches
neither shows an empty picker and a message; it never crashes the app. A capture is filed under the block's
`stream`, else its `key`, else its `block`.

## Look: Next Up replica, with Lucide and Inter

The layout, spacing, states and animations are Next Up's (same HTML and CSS, same window sizes). Deliberate
differences: accent colour teal instead of blue; Lucide icons (one set, stroke 1.75) instead of text glyphs and
CSS shapes; Inter variable (tabular numerals for timers) instead of the system font; added Niyyah rows (block,
product, lane in the composer; connection in Settings; Focus button and chip); no software-update section. The
quick-capture popover is the same composer, always open. Assets and licences: `THIRD_PARTY.md`.

### What stays on your Mac

Niyyah stores a task's name, lane, block (stream) and product. These fields are **local only** for now, kept in
`tasks.json` in the app data folder and shown in the panel: **link**, **timer (tracked time, running state)**,
**deadline with a time**, and later **edits** of a task's name. Marking a task done in the panel does not
complete it in Niyyah either. Proposed backend follow-up: item fields `link`, `deadline_at` (datetime),
`tracked_ms`, and a way to update or complete an item with a device token. No backend change is part of this app.

Sync layer, ready for that contract: each panel task has a client UUID (`id`), which travels with its capture
as `client_id` through the offline queue but is **not sent yet** (`Capture::to_item` in `core/src/payload.rs`
is the one place that maps app fields to the wire; a test pins that nothing local-only leaks). Adopting the
contract means adding fields there and in `captureFor` (`ui/tasklogic.js`).

## How a capture travels

1. The popover has a text field, a **block** select (pre-filled from the current time), a **product**
   select, a **lane** chip (Now, **Next**, Someday) and Save. Enter saves, Escape closes.
2. Save writes the capture to a queue file in the app data folder (mode 0600) and returns at once.
3. A background sender posts it. The server's 201 is the only thing that removes it from the queue.
   Network errors, 429 and 5xx back off 5 s, 10 s, 20 s ... up to 15 min. A 401/403 keeps the capture
   and asks you to check the token. Any other 4xx (the server will never accept it) parks the capture
   as "refused" in the popover list, with Retry and Dismiss. Nothing is dropped silently.
4. The queue is at-least-once: if the server stored a capture but the reply was lost, the retry creates a
   second task (the items API has no idempotency key).

## API contract (what the app calls)

Auth for both: `Authorization: Bearer nyd_...` (a device token, created and revoked in Niyyah under
**Settings > Devices**; scope "create tasks only").

`POST /api/v1/vault/items` (existing `ItemCreateIn`, lane form):

```json
{"text": "Call the bank", "lane": "next", "stream": "OT", "products": ["alisha"]}
```

`lane` is `now`, `next` or `backlog` (the app's "Someday"). `stream` is required with `lane` (the API files
an undated item under a stream); `products` is omitted when none is picked. `day` is never sent.

`GET /api/v1/capture/options` (new in Part A, read-only; field names are this app's assumption and must match
Part A):

```json
{"blocks":   [{"block": "OT", "start": "06:00", "end": "16:03", "what": "Outcome time", "stream": "OT"}],
 "products": [{"slug": "alisha", "name": "Alisha Noor", "block": "OT"}]}
```

The block pre-selected at capture time is the one whose `start`..`end` (local time, end exclusive, wraps past
midnight) covers now. A capture is filed under the block's `stream`, or its `block` key if `stream` is null.
The reply is cached for the session and the last good copy is kept on disk, so a capture can still be filed
while offline.

## Security rules (each has a test in `core/tests`)

- The server URL must be `https`. `http` is accepted only for `localhost`, `127.0.0.1` and `::1` (tests).
  URLs with credentials, a query or a fragment are refused. Redirects are never followed.
- The token is stored only in the macOS Keychain (service `bd.burak.niyyah.menubar`). It is never written to
  a file or a log line, and is sent only to the configured server. Only `nyd_` device tokens are accepted;
  an export token (`nyt_`) is refused when pasted. The paste field is cleared once the token is stored.
- Capture text is not logged either.
- The webview never reaches the network: its CSP is `default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self'; connect-src ipc:` (no `unsafe-inline`, no remote host). The Rust core makes every request.
- Capabilities are `core:default` only: no file, shell, http or opener access from the web layer.

## Develop and test (Linux or Mac)

```sh
cd apps/menubar/core
cargo test                    # queue, retry, offline-then-online, payload, https rule, secrets, CSP,
                              # task store, link rule, awake clock, focus rules
cargo clippy --all-targets -- -D warnings
cargo test -- --ignored       # the end-to-end test (see below)
cd ..
node --test ui-tests/*.test.js   # timer math, deadlines, link check, reorder, shortcut cycling, payload mapping
```

`src-tauri` (the shell) needs a webview and only builds on the Mac: `cd src-tauri && cargo clippy -- -D warnings`.

End-to-end against the real API (device-token API is merged, PR #114):

```sh
NIYYAH_E2E_URL=https://<niyyah-api-host> NIYYAH_E2E_TOKEN=nyd_... cargo test -- --ignored
```

It creates one task named "menubar e2e capture (delete me)". Delete it afterwards.

## Build on your Mac (Apple Silicon, unsigned)

```sh
scripts/build-macos.sh
```

It checks for Xcode command line tools and rustup, updates stable Rust (Tauri 2 needs 1.90 or newer), adds the
`aarch64-apple-darwin` target, installs the Tauri CLI if missing, runs the core tests, builds, and prints the
paths of the `.app` and the `.dmg`. The bundle is ad-hoc signed only: there is no Developer ID and no
notarisation, so macOS will not open it silently the first time.

## First run on your Mac (Gatekeeper)

1. Open the `.dmg`, drag **Niyyah Capture** to Applications.
2. In Applications, **right-click (or Control-click) Niyyah Capture, choose Open**, then **Open** in the dialog.
3. If there is no Open button in that dialog (macOS 15 Sequoia and later removed the shortcut): try to open the
   app once, then go to **System Settings > Privacy & Security**, scroll to the message about "Niyyah Capture"
   and click **Open Anyway**, then confirm with your password.
4. Last resort: `xattr -dr com.apple.quarantine "/Applications/Niyyah Capture.app"`.
5. The app has no Dock icon. Click the small ring in the menu bar to open the panel under it, or press **Option+Command+N** for quick capture. The first time, a short note explains each permission before macOS asks for it.
6. Create a device token in Niyyah: **Settings > Devices**, copy it (it is shown once). In the app, open the tray
   menu, **Settings…**, and under "Niyyah connection" paste your Niyyah address and the token. Press Store.
   (The quick-capture popover has the same fields under its own Settings link.) macOS may ask to let the app
   use the Keychain: allow it.
7. Permissions, asked when each feature is first used: **Automation** (browser-tab reminders, Chrome or Safari),
   **Microphone** and **Speech Recognition** (dictation). Window-switch reminders and global shortcuts need no
   permission on current macOS; if a shortcut does nothing, add the app under **Privacy & Security >
   Accessibility** or **Input Monitoring**.
8. First capture: press **Option+Command+N**, type a task, pick a block and product, press **Save**. It appears in
   Niyyah within a few seconds. A refused-token message means the token was revoked or mistyped: create a new one.

Revoke a lost laptop's access in Niyyah under **Settings > Devices > Revoke**; the app then keeps your captures and
shows that the token was refused.

## What is verified

On the Linux jump host: everything in `core/` (unit tests, flow tests, the secrets test, the CSP test), against a
scripted local HTTP server, and the pure panel logic in `ui-tests/`. On the Mac (Apple Silicon, macOS 26.5): `cargo clippy -D warnings` on `core` and `src-tauri`, the core tests, the
release build, an ad-hoc signed `.app`/`.dmg`, and a launch that stays up and runs its queue flush without a token.
Not verified (needs a person at the screen, a token, or both): the Keychain store, tray icon and template
rendering, the global shortcuts, the focus panel's look and drag, dictation and its permission prompts,
Automation prompts for the browser-tab reminder, window-switch reminders, and the CSP inside the real webview
(a blocked script would show as a dead panel). The end-to-end test against the real API needs a real token.
