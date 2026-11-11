# Unofficial Vibes provider (`vibes-unofficial`)

Generate real images and videos through **your own free Meta Vibes account**, from
inside your coding agent, without pasting a prompt into the web app.

**Read the risk section before you use this.** It works by driving a
reverse-engineered route that Meta does not sanction. It is off by default.

---

## Why this exists at all

Meta publishes no API for Vibes — no endpoint, no key, no OAuth client. The only
route that works is the one the community reverse-engineered: replay the session
cookie your browser received when you signed in.

Freevibes does **not** reimplement that work. It drives
[**VibesAI-api**](https://github.com/mir-ashiq/VibesAI-api) — a maintained Python
client and REST server (v1.6.0, Nov 2026) that already speaks the private
endpoints, keeps your session refreshed in the background, and can re-login by
itself.

```text
Coding agent  →  Freevibes (TypeScript, MCP)  →  HTTP  →  VibesAI-api sidecar  →  vibes.ai
                                                          (Python, owns cookies)
```

Keeping the reverse engineering in one maintained place means Freevibes does not
carry a second, drifting copy of Meta's private API. When vibes.ai changes, that
project fixes it and you update one dependency.

---

## How "log in once" actually works

The sidecar holds two credentials:

| Credential | Where it comes from | What it does |
| --- | --- | --- |
| `VIBES_META_SESSION` | `vibes.ai` cookie | Authenticates every request |
| `AUTH_META_COOKIES` | `auth.meta.com` cookies | Lets the sidecar **re-login automatically** when the session expires |

With both set, the sidecar refreshes the session every 25 minutes in the
background (`VIBES_REFRESH_INTERVAL=1500`) and logs itself back in when it
expires, persisting the refreshed cookie to `VIBES_COOKIE_FILE`.

So you copy cookies **once**, not once per job. Be clear-eyed about the limits:

- The `meta_session` cookie alone expires in roughly an hour of use. That is why
  `AUTH_META_COOKIES` matters — without it you will be re-copying cookies often.
- Even with auto re-login, Meta can invalidate the whole chain at any time
  (password change, security check, logout elsewhere).

---

## Setup

### 1. Run the sidecar

Docker is the least fiddly route:

```bash
docker run -d --name vibes-api \
  -p 8000:8000 \
  -e VIBES_META_SESSION="paste-your-meta_session-cookie" \
  -e AUTH_META_COOKIES="paste-your-auth.meta.com-cookies" \
  -e VIBES_API_KEY="pick-a-local-password" \
  -v vibes-data:/data \
  <the image published by VibesAI-api>
```

Or from source:

```bash
git clone https://github.com/mir-ashiq/VibesAI-api.git
cd VibesAI-api
pip install -e ".[server]"
export VIBES_META_SESSION="..."   # required
export AUTH_META_COOKIES="..."    # strongly recommended: enables auto re-login
export VIBES_API_KEY="..."        # optional but do set one
uvicorn server.app:app --host 127.0.0.1 --port 8000
```

**Where to get the cookies:** follow that project's
[`COOKIES.md`](https://github.com/mir-ashiq/VibesAI-api/blob/main/COOKIES.md).
Short version: sign in at vibes.ai, open DevTools → Application → Cookies →
`https://vibes.ai` → copy the value of `meta_session`.

> Never paste a cookie into a chat window, an issue, or a commit. It is a live
> credential for your Facebook/Instagram account.

Check it is alive:

```bash
curl -s http://127.0.0.1:8000/health
curl -s -H "X-API-Key: your-local-password" http://127.0.0.1:8000/api/v1/me
```

### 2. Point Freevibes at it

The provider is disabled until you say otherwise:

```bash
export FREEVIBES_PROVIDER=vibes-unofficial
export FREEVIBES_ALLOW_UNOFFICIAL=true
export FREEVIBES_VIBES_BASE_URL=http://127.0.0.1:8000
export FREEVIBES_VIBES_API_KEY=your-local-password   # match VIBES_API_KEY
export FREEVIBES_VIBES_PROJECT=Freevibes            # vibes.ai project to write into
```

Add these to the `env` block of your MCP client config so the server inherits
them. See [CLIENT-SETUP.md](CLIENT-SETUP.md).

### 3. Verify

```bash
node dist/install/cli.js doctor      # provider should read vibes-unofficial, operational: yes
node dist/install/cli.js capabilities
```

Then ask your agent: *"Generate a 5-second cinematic video of a warrior on
horseback."* The file lands in `FREEVIBES_ASSET_DIR` (default
`~/.openvibes/assets`) and the tool returns its path.

---

## Risk, stated plainly

This route is **not sanctioned by Meta**, and this project does not pretend
otherwise. In `capabilities` it is reported as `UNOFFICIAL` — never as
`VERIFIED_WORKING` and never as officially supported.

What can go wrong:

1. **Your account can be restricted.** Automated use of the consumer interface
   may breach the Vibes terms of service. That risk is yours, on your account.
2. **It breaks without warning.** Meta changes their web app whenever they like.
   Expect breakage; fix it by updating the sidecar.
3. **A cookie is a live credential.** Anyone who obtains it can act as you on
   vibes.ai. Keep it in an environment variable or a file with tight
   permissions — never in a repo, a screenshot, or a chat message.
4. **Quota is real.** Free generations are limited. Each variation spends one.
   Freevibes requests a single variation for video by default.

### What Freevibes deliberately will not do

These are permanent limits, not settings:

- Rotate accounts or otherwise obtain more free generations than your account allows.
- Bypass CAPTCHA, rate limits, or paywalls.
- Run a browser bot against the consumer UI.
- Present this route as official, free-tier-sanctioned, or supported by Meta.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `sidecar is not reachable` | Container/process not running, or wrong port | `curl http://127.0.0.1:8000/health` |
| `HTTP 401` / `cookie ... expired` | `meta_session` expired | Set `AUTH_META_COOKIES` so it re-logins; or copy a fresh cookie |
| `HTTP 429` | Free quota exhausted | Wait for the quota to reset; check the vibes.ai UI |
| `batch reported completion but contained no media` | Generation failed server-side | Check the project in vibes.ai |
| Guard error mentioning `FREEVIBES_ALLOW_UNOFFICIAL` | Opt-in missing | Set it to `true` |
| Tools list fine, generation blocked | Still on the default provider | Set `FREEVIBES_PROVIDER=vibes-unofficial` |

---

## If you would rather not use this

The default provider, `meta-vibes-free`, stays exactly as it was: it reports
generation as `BLOCKED` with the evidence for why, and sends nothing. See
[META-FEASIBILITY.md](META-FEASIBILITY.md). Both providers ship together; you
choose one.

Credit for the reverse engineering belongs to
[VibesAI-api](https://github.com/mir-ashiq/VibesAI-api), not to this project.
