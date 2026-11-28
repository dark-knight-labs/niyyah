# Niyyah Capture (menu-bar app)

A small macOS menu-bar app that files a task into Niyyah in a few keystrokes. Press **Option+Command+N**,
type, press Enter. Bundle id `bd.burak.niyyah.menubar`, shown as "Niyyah Capture". Tasks only (v1).

Stack: Tauri 2. `core/` is plain Rust (queue, API client, token store) and is tested on Linux;
`src-tauri/` is the thin shell (tray icon, global shortcut, popover); `ui/` is the web layer
(plain HTML/CSS/JS, no build step, no remote scripts or styles). Next Up is a reference for the idea only:
no code is taken from it.

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

Auth for both: `Authorization: Bearer nyd_...` (a device token, minted in the Niyyah web app under Settings > Devices, scope
"create tasks only", revocable).

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
cargo test                    # queue, retry, offline-then-online, payload, https rule, secrets, CSP
cargo test -- --ignored       # the end-to-end test (see below)
```

End-to-end against the real API (pending until the device-token API is merged and deployed):

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
5. The app has no Dock icon. Look for the small ring in the menu bar, or press **Option+Command+N**.
6. In Niyyah (web), open **Settings > Devices**, type a name for this Mac (for example "Work MacBook") and press
   **Create device token**. The token (`nyd_...`) is shown once: press **Copy**. If you lose it, revoke it there
   and create another.
7. In the app, click **Settings** in the popover. Set the server URL to `https://<your-niyyah-api-host>`
   (the address of your Niyyah API) and paste it into **Device token**. Press **Store**. macOS may ask to let the app use the
   Keychain: allow it.
8. First capture: press **Option+Command+N**, type a task, pick a lane (Now, Next or Someday), press **Save**. It appears in Niyyah within
   a few seconds. A refused-token message means the token was revoked or mistyped: create a new one.

Revoke a lost laptop's access in Niyyah under **Settings > Devices > Revoke**; the app then keeps your captures and
shows that the token was refused.

## What is verified

On the Linux jump host: everything in `core/` (23 unit tests, 11 flow tests, the secrets test, the CSP test), against a
scripted local HTTP server. Not verified on Linux, and so to be checked on the Mac: the macOS build and `.dmg`,
the Keychain store (`KeychainStore`, `keyring` crate), the global shortcut, the tray icon and its template
rendering, popover placement (it opens centred, not under the icon) and hide-on-blur, and the CSP running inside
a real webview. The end-to-end test against the real API waits for the device-token API.
