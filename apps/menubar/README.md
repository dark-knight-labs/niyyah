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

## Focus: one task, one primary window

Focus is part of the task, not a second thing. There is **one entry point, "New Task"**, and one control on
every open task row (the play icon). There is no separate Focus button, screen or tab, and no focus without a task.

- **New Task** (button, or Ctrl+Alt+N): type the task, pick a stream and optional products, and tick **"Focus on this
  task"** to also choose its main window, any extra windows that are fine to use, and a timer (count-up, or a
  countdown of 1 to 240 minutes). **Save** then creates the task, files it in Niyyah and starts the focus on that
  same task, in one step. A quick focus is just a new task with the text you type.
- **Play on a task row** starts a focus on exactly that task: a small picker opens right under the row (main window,
  allowed windows, timer, **Start focus**). On the task being focused the same control pauses and resumes.
- The focused task's row is highlighted and shows the state, the timer and the primary window; the status chip and
  the window list (below) sit directly under that row, in the same popup list.

Starting a focus starts the task's timer.

Three states, shown the same way in the popup's window list, the task row and the tray icon:

| Front window | Popup window list | Task row / chip | Tray icon | Popup shake |
|---|---|---|---|---|
| **Primary** | solid accent fill, "PRIMARY" tag | "Focus · <window> · 12:34" | calm template icon | no |
| **Allowed** (secondary) | outlined, soft tint, "ALLOWED" tag, "Remove" button | "Focus · allowed window" | subtle blue tint | no |
| **Other** (outside the set) | neutral, muted, "Allow" button | amber "Back to Safari" | **blinks amber** | **shakes** |
| Primary closed | "CLOSED" tag | amber "<app> window closed" | blinks amber | shakes |

The timer keeps running on the primary and on allowed windows; only an "other" window nudges (after about
1.5 s, so a quick Cmd-Tab and back is not counted). Our own windows (the popup) are neutral. With macOS
**Reduce Motion** on, there is no blink and no shake: the nudge becomes a steady amber icon and the allowed tint
is unchanged. The state table is tested twice (`core/src/focus.rs` `presentation`, `ui/tasklogic.js`
`presentFor`).

Change it mid-session in the popup's window list: click any window to make it the **primary** (the old primary
becomes allowed, so you can go back without a nudge); **Allow** and **Remove** add or drop secondary windows. The
chip pauses and resumes (pause stops the session and the task timer), and **✕ ends** the session. The task earns
tracked time only while you are on the primary or an allowed window and the session is not paused; ending or
pausing stops the task timer, which writes the time to the task.

The primary window and the running session are saved (`focus.json`) and resume after a restart. Every finished
session is appended to `sessions.jsonl` (`task_id`, `client_id`, `task`, `app`, `window`, `allowed_count`,
`mode`, times, `duration_ms`, `away_ms`, `away_count`, `completed`). Both files are owner-only (0600).

**Window names never leave this Mac.** The app and title of the primary and allowed windows exist only in the
running app, `focus.json` and the local part of `sessions.jsonl`. A capture has no field for them (a Rust test
pins that none of window, title, app, bundle id, primary, allowed, lane, link, deadline, timer or client id is in
the server body), and `syncable()` in `ui/tasklogic.js` strips `app` and `window` from a session record before
it could ever be sent (tested).

Permissions, least first: the front app and the list of running apps need none. **Window titles need
Accessibility** (AXUIElement); the dialog's "Allow window titles" button triggers the system prompt, and the
first-run note explains it beforehand. Without it, focus works per app. **Screen Recording is never needed.**
Automation is separate and only for the browser-tab reminder.

## Menu bar

The app lives in the menu bar only (no Dock icon). The **menu-bar item is the icon and, while a focus session
runs, the timer** (`12:34`). It never shows a window title or task text. Click the icon: the Next Up style panel
opens as a popup right under it and closes when you click elsewhere or press Esc (unless "Stay open when I click
elsewhere" is ticked). Option+Command+N opens the quick-capture popover instead. The timed check-in also blinks
the icon (8 s) when the popup is closed.

Native vs custom: the tray icon (a monochrome template image, so macOS tints it; blue-tinted and amber variants
are coloured images) and its dropdown (Capture, Show tasks, Settings, Quit) are the **native** macOS menu; Tauri
cannot style them, and Next Up itself uses a native menu. The timer text beside the icon is native too, in the
system font. The popup and every dialog are the custom Next Up design.

## Streams and products

The picker lists your Niyyah **streams** (Kahf, Alisha Noor, ...) in a pale-blue column of small-radius chips;
long names get an ellipsis and a tooltip. **Products are optional**: the chosen stream's products show as a
second pick with nothing preselected, and a capture works with a stream alone. There is **no lane** in the UI or
in the payload; lanes and products are not linked by default, and Niyyah uses them for its per-stream weekly log
of finished tasks. The last stream you used is preselected.

`GET /api/v1/capture/options` (niyyah `docs/capture-api.md`) lists every non-archived stream with its products
nested: `streams: [{slug, name, color, products: [{slug, name}]}]`. The chip shows `name` (streams have no short
name). The deprecated top-level `blocks`, `products` and `day` are ignored. Junk gives an empty picker and a
message, never a crash. A capture is `{text, stream, products?}`; `client_id` stays in the local queue. The app
always sends `stream`: a task with no stream would not appear in Niyyah's weekly log.

**Server release dependency:** the live server accepts a capture with a stream and no `lane` or `day` only after
the Niyyah release that includes migration `b4d6f8a0c2e5` (an owner-approved release step). **Until that release,
captures against production get a 422**; they are kept in the queue as "refused" with Retry and Dismiss, never
dropped. A 422 is now a real error (an unknown stream is one) and is never retried; the earlier one-time
`lane: "backlog"` retry was removed.

## Look: Next Up replica, with Lucide and Inter

The layout, spacing, states and animations are Next Up's (same HTML and CSS, same window sizes). Deliberate
differences: Lucide icons (one set, stroke 2) instead of text glyphs and CSS shapes; Inter variable (tabular numerals for timers) instead of the system font; added Niyyah rows (stream and
optional product in the composer; connection in Settings; a Focus switch in the composer and a play control on each task row); the pin means "stay open when I click elsewhere" (off by default, it is a menu-bar popup); no software-update section. The
quick-capture popover is the same composer, always open. Assets and licences: `THIRD_PARTY.md`.

### What stays on your Mac

Niyyah stores a task's name, stream and product (and, with the new sync routes, link, deadline, tracked time and timer; this app does not send those yet). These fields are **local only** for now, kept in
`tasks.json` in the app data folder and shown in the panel: **link**, **timer (tracked time, running state)**,
**deadline with a time**, and later **edits** of a task's name. Marking a task done in the panel does not
complete it in Niyyah either. Proposed backend follow-up: item fields `link`, `deadline_at` (datetime),
`tracked_ms`, and a way to update or complete an item with a device token. No backend change is part of this app.

Sync layer: each panel task has a client UUID (`id`). It is sent as `client_id` with the capture (only when it
is a real UUID; anything else would be a 422), so a retry after a lost reply is the same task, not a second one:
the server dedupes on it and the new device routes key on it. `Capture::to_item` in `core/src/payload.rs` is the one
place that maps app fields to the wire; a test pins that nothing else local-only leaks. Adopting link, deadline and
timer fields later means adding them there and in `captureFor` (`ui/tasklogic.js`).

## How a capture travels

1. The popover has a text field, the **stream** column (last used preselected), optional **product** chips and
   Save. Enter saves, Escape closes. No lane.
2. Save writes the capture to a queue file in the app data folder (mode 0600) and returns at once.
3. A background sender posts it. The server's 201 is the only thing that removes it from the queue.
   Network errors, 429 and 5xx back off 5 s, 10 s, 20 s ... up to 15 min. A 401/403 keeps the capture
   and asks you to check the token. Any other 4xx (the server will never accept it) parks the capture
   as "refused" in the popover list, with Retry and Dismiss. Nothing is dropped silently.
4. The queue is at-least-once, but the capture carries its `client_id`, so if the server stored it and the reply
   was lost, the retry is recognised and answered with the first task (HTTP 200), not a second one.

## API contract (what the app calls)

Auth for both: `Authorization: Bearer nyd_...` (a device token, created and revoked in Niyyah under
**Settings > Devices**; scope "create tasks only").

`POST /api/v1/vault/items` (a device-token task on today, under the stream):

```json
{"text": "Call the bank", "stream": "kahf", "products": ["dns"]}
```

`products` is omitted when none is picked. `day` and `lane` are never sent (the server defaults the day to today
and ignores a lane). See "Streams and products" for the release this depends on.

`GET /api/v1/capture/options` (read-only, device token allowed):

```json
{"streams": [{"slug": "kahf", "name": "Kahf", "color": "violet", "products": []},
             {"slug": "alisha", "name": "Alisha Noor", "color": "rose", "products": [{"slug": "cart", "name": "Cart"}]}]}
```

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
- Tauri command ACL: Tauri 2.12 enforces capabilities on app commands only when the build has an app manifest
  (`webview/mod.rs`: the check runs for app commands only if a manifest exists; without one every local window may
  call every command). `build.rs` therefore registers all commands, and `capabilities/` gives the popover, the
  panel and the reminder overlay exactly the commands their page calls, plus `core:default`; no file, shell, http
  or opener access. `core/tests/acl.rs` checks that the manifest, the handler list, the capability files and the
  `invoke` calls in the page scripts agree in both directions.
- Changing the server to a different host (scheme, host or port) is **refused** unless you also paste a new device
  token: the old token belongs to the old host and is never sent to a new one, and queued capture text never goes
  there either. Settings validate the token first and save nothing if it is bad.
- The only text beside the tray icon is a timer (`^[0-9:]{0,8}$`, enforced in Rust); anything else is dropped.
- Local files (`tasks.json`, `focus.json`, `sessions.jsonl`, the queue) are written 0600; the session log rotates at
  about 1 MiB; the options reply is read at most 1 MiB.

## Known risks

- Accessibility (AX) calls for window titles can block when an app is hung. They run off the UI thread (the window
  list is an async command, the watcher looks at the screen with its lock released), but a very slow app can still
  delay a nudge by a poll.
- Nothing here has been seen on a real macOS screen from this build (see "What is verified").

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
8. First capture: press **Option+Command+N**, type a task, pick a stream (and, if you like, a product), press **Save**. It appears in
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
