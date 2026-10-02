# Catstep MD iOS Shortcuts presets

Three ready-to-build Shortcuts that hit the Catstep MD desktop app's `/capture` HTTP endpoint. They run on iPhone and iPad (iOS 15+) and need nothing more than the app's bearer token — plus a way for your phone to reach the desktop's loopback-only server (see [Reaching the endpoint](#reaching-the-endpoint)).

These are step-by-step recipes, not signed `.shortcut` files. The Shortcuts app guards every imported action against URL-scheme injection, and Apple's iCloud share links require the original author's developer account. Building once on your own device gives you ownership and avoids any third-party trust step.

## How the endpoint actually works

The capture server listens on **`127.0.0.1` only** — it is hard-bound to loopback and there is no "listen on LAN" option. This is deliberate: a bearer token alone is not strong enough to expose a file-writing endpoint to your whole Wi-Fi segment.

Consequences for iOS:

- No Shortcuts action can POST to `http://<mac-ip>:7777/...` — that address is unreachable by design. Don't try it.
- Every recipe below therefore routes traffic through **SSH**, which makes the request originate *from the desktop itself*, where `127.0.0.1` is meaningful.

## Before you start (desktop)

1. Open **Catstep MD** and a workspace folder (without one the endpoint answers `503`).
2. Go to **Settings → AI Models & Extensions** (中文界面：**设置 → AI 助手模型与服务**).
3. Find the **HTTP capture endpoint** card and toggle it on.
4. Take note of the three fields the panel shows:
   - **Endpoint** — read-only, default `http://127.0.0.1:7777/capture`, with a copy button.
   - **Folder** — the workspace sub-folder captures land in (default `inbox`).
   - **Token** — the bearer token, with Show / Copy / Regenerate buttons. Copy it.
5. Sanity-check from a terminal on the same machine (the panel's curl snippet does exactly this):

   ```sh
   curl -s http://127.0.0.1:7777/capture/health \
     -H "Authorization: Bearer YOUR-TOKEN"
   # -> {"ok":true,"version":"...","workspace":"...","inbox_folder":"inbox","workspace_open":true}
   ```

You cannot change the port from the panel — the endpoint field is read-only and defaults to `7777`.

## Reaching the endpoint

Pick one. Both keep the endpoint loopback-only; nothing on the desktop needs to change.

### Path A — local port forward (`ssh -L`), works with all three recipes as written

From an SSH client **on the iPhone** that supports local port forwarding (e.g. Blink Shell, Termius — check your client supports `-L` forwards), connect to the computer over the same network:

```
ssh -N -L 7777:127.0.0.1:7777 YOUR-USER@YOUR-DESKTOP-IP
```

While that session is alive, `127.0.0.1:7777` **on the iPhone** tunnels to `127.0.0.1:7777` **on the desktop**. The recipes below then use the exact same URL as the desktop's own curl snippet: `http://127.0.0.1:7777/capture`.

Desktop prerequisites:

- **macOS**: System Settings → General → Sharing → **Remote Login** (on by default config-independent; just enable it).
- **Windows**: Settings → System → Optional Features → add **OpenSSH Server**, then start the `sshd` service.
- **Linux**: install/enable `sshd` as usual.

iOS caveat: iOS suspends background network sessions, so keep the SSH app open (or in a state your client documents for long-lived tunnels) while capturing.

### Path B — Shortcuts' built-in "Run Script Over SSH", no port-forwarding app needed

Shortcuts ships a **Run Script Over SSH** action. Instead of the phone calling the endpoint, the *desktop* runs `curl` against its own loopback:

1. **Text** action assembling the JSON body (same fields as the recipes below).
2. **Run Script Over SSH** — host: your desktop (SSH enabled as above), script:

   ```sh
   curl -sS -X POST http://127.0.0.1:7777/capture \
     -H "Authorization: Bearer YOUR-TOKEN" \
     -H "Content-Type: application/json" \
     -d '<JSON from the Text action>'
   ```

Caveat: unlike `Get Contents of URL`'s structured JSON body, the Text action does not JSON-escape your input — text containing `"` will break the payload. Path A (where Shortcuts serializes the JSON itself) is the more robust route for free-form input; Path B is fine for controlled, short captures.

## The three recipes

All three assume **Path A** (`ssh -L` tunnel up, URL = `http://127.0.0.1:7777/capture`). For Path B, swap the "Get Contents of URL" step for the Run Script Over SSH pattern above, keeping the same JSON fields.

Wire format (what the server actually accepts):

```
POST /capture
Headers: Authorization: Bearer <token>
         Content-Type: application/json
Body:    { "title"?, "content", "url"?, "tags"?, "inbox"?, "append_path"? }
-> 200 {"ok":true,"path":"..."}   401 wrong token   400 bad JSON / missing content
-> 503 no workspace open          500 disk error
```

`content` is the one required field. `append_path` ignores `title`/`url`/`tags`/`inbox`. Bodies are capped at 8 MiB.

### 1. Quick capture — `catstep-quick-capture`

Action chain in Shortcuts:

1. **Ask for Input** — `Text`, prompt: `Capture to inbox`.
2. **Get Contents of URL**
   - URL: `http://127.0.0.1:7777/capture`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer YOUR-TOKEN`
     - `Content-Type: application/json`
   - Request Body: `JSON`
     - `content` → `Provided Input` (markdown text the user typed)
     - `title` → `Quick capture <Current Date>` (use the date variable, format = ISO 8601 short)
     - `inbox` → `true` (boolean; it defaults to true, so this is optional)
3. **If** the response status is `200`:
   - **Show Notification** with `Saved: <title>`.
   - Otherwise: **Show Notification** with `Capture failed: <Contents of URL>`.

The server writes `inbox/<timestamp>-<slug>.md` into your workspace and replies with the full path. `title` is optional too — when omitted, the first `# heading` of the content becomes the title, else `Untitled`.

Add to **Share Sheet** so any selected text on iOS triggers it. Add to **Home Screen** for a one-tap launcher.

### 2. Append to today's daily note — `catstep-append-daily`

Reuses the endpoint's `append_path` mode so you don't accumulate a new file per thought.

1. **Ask for Input** — `Text`, prompt: `Append to today`.
2. **Format Date** — current date, format `yyyy-MM-dd`.
3. **Get Contents of URL**
   - Same URL/headers as recipe #1.
   - Request Body JSON:
     - `content` → `- {{Provided Input}}` (the leading `- ` makes each entry a bullet item; the server prepends the newline that separates entries, so don't add one yourself)
     - `append_path` → `Daily/{{formatted-date}}.md`

The default daily-notes layout is `Daily/YYYY-MM-DD.md`. If you changed the folder or format in Catstep MD's editor settings, make `append_path` match — it is resolved workspace-relative, and `..`, absolute paths, and drive-letter paths are rejected with a `400`.

If `Daily/<date>.md` doesn't exist yet, the endpoint creates it (parent folders included).

### 3. Clip a URL from Safari — `catstep-clip-url`

Run this from Safari → Share → Shortcuts → Catstep MD: Clip URL. Or paste a URL into Shortcuts manually.

1. **Get Contents of Web Page** (input: URL from share sheet).
2. **Make Rich Text from HTML** (article body extracted by iOS).
3. **Make Markdown from Rich Text**.
4. **Get Details of Safari Web Page** (URL → keep) and (Title → keep).
5. **Get Contents of URL**
   - Same URL/headers as recipe #1.
   - Request Body JSON:
     - `content` → the markdown from step 3
     - `title` → the page title
     - `url` → the page URL
     - `tags` → `["web"]` (optional; provide as a JSON array)
6. Notification on success — show the `path` field from the response.

Do **not** hand-build a front-matter block into `content`. The server strips any incoming front matter and writes its own (`title`, `source`, `tags`, `inbox`, `captured_at`) from the structured fields above — sending your own YAML just gets it deleted.

iOS's HTML-to-markdown is not great with code blocks; for technical articles prefer the desktop browser web clipper extension. For news, blog posts, and recipes it works well enough.

## Hand-build vs. iCloud share links

This README is the canonical source. If a future Catstep MD release ships iCloud share links, they'll appear at <https://github.com/maobukeai/catstep-md> with QR codes. Until then, a 30-second hand-build is the fastest path. Built shortcuts are local to your iCloud account; nobody else's Shortcuts app can change them.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Connection refused from the phone | The `ssh -L` tunnel isn't up, or the endpoint toggle is off (check the card shows the *running* status pill). |
| `401` | Token regenerated on the desktop — old tokens die immediately; re-copy it. |
| `400` with `missing field: content` | Body uses the wrong key. The field is `content`, not `body` or `text`. |
| `503` | No workspace folder open in Catstep MD. |
| `400` mentioning `..` or absolute path | `append_path` must be workspace-relative. |

## Privacy

The endpoint never leaves your computer: it is bound to `127.0.0.1`, so every capture arrives over your SSH session (Path A) or as a local `curl` on the desktop (Path B) — no third-party server, no telemetry, no LAN exposure. The shortcuts only ever talk to the URL you typed into them, with the token you pasted, and only when you tap them. See <https://github.com/maobukeai/catstep-md> for the endpoint's full protocol.
