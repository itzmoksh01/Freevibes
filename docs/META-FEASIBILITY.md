# Meta Vibes feasibility report

**Checked:** 10 November 2026
**Scope:** whether an MCP server can generate images and videos through a user's
own **free Meta Vibes entitlement**, unattended, without violating Meta's terms.
**Outcome:** **BLOCKED** for every generation modality. The infrastructure in
this repository is complete and tested; the Meta generation provider is not
operational and says so.

This document is the human-readable twin of `src/evidence.ts`. The server reads
the same table, so what you read here is exactly what the tools report.

---

## 1. Method

Capabilities were checked against Meta's own documentation, not tutorials or
third-party summaries. Each row records the source URL and the date it was
checked. Two rules were applied throughout:

1. **A feature is not an API.** A help-centre page describing a button in an app
   proves the capability exists for humans. It proves nothing about
   programmatic access.
2. **Products are never merged.** Vibes, Meta Model API, Muse Image, Muse Spark
   and SAM are separate products with separate entitlements. A capability in one
   is not evidence of a capability in another.

### Sources consulted

| Source | What it establishes |
| --- | --- |
| https://www.meta.com/help/artificial-intelligence/1337455336906126/ | Vibes image/video/animate exist as consumer flows in the Meta AI and Vibes apps |
| https://www.meta.com/help/artificial-intelligence/996454095987249/ | Video editing is a consumer flow; maximum clip length is 10 seconds |
| https://dev.meta.ai/docs/models | The complete published model catalogue for Meta Model API |
| https://dev.meta.ai/docs/pricing-rate-limits | Billing model, per-image price, rate limits, absence of a free tier |
| https://dev.meta.ai/docs/muse-code/configuration | Muse Code settings file location and shape (used by the installer) |
| https://dev.meta.ai/docs/muse-code/extending | Muse Code `mcp_servers` block format (used by the installer) |

---

## 2. Product separation

The single most important finding is that the product users call "Meta Vibes"
and the product that has an API are different things.

| Product | What it is | API? | Free plan? |
| --- | --- | --- | --- |
| **Meta AI / Vibes** (`vibes.ai`, mobile apps) | Consumer creation experience: generate images, animate them into vibes, remix, post to a feed | **No published API** | Yes |
| **Meta Model API** (`api.meta.ai/v1`) | Developer platform with Bearer-key access to Muse models | Yes, documented | **No — pay-as-you-go only** |
| **Muse Code** | Meta's terminal coding agent; an MCP *client* | n/a (consumes MCP) | Subscription |
| **Muse Image** (`muse-image-1.0`) | Image generation model on Model API | Yes, `POST /v1/images/generations` | No — $0.01/image |
| **SAM 3.1** | Segmentation: boxes and masks | Yes | No |
| **Muse Voice Transcribe** | Speech to text | Yes | No |

There is no overlap between "free" and "has an API". That gap is the entire
finding.

---

## 3. Capability findings

### 3.1 Text-to-image through Vibes — `BLOCKED`

The Meta Help Centre documents image generation as a flow inside the Meta AI and
Vibes apps: you prompt, you get images, you may turn one into a vibe.

It publishes no endpoint, no request schema, no authentication mechanism and no
asset-retrieval method. There is nothing to call.

> A user-facing feature is not an API. No official request schema, auth flow or
> endpoint is published for Vibes image generation.

### 3.2 Text-to-video and image-to-video through Vibes — `BLOCKED`

Animate, remix and video editing are documented consumer flows. The 10-second
clip limit is documented. Again, no developer surface of any kind is published.

> Video generation exists only inside the consumer apps and vibes.ai. There is
> no documented API, no OAuth client, and no authorized automation interface.

### 3.3 Programmatic retrieval and download — `BLOCKED`

Saving a generated vibe is a user action in the app. No documented download
endpoint or asset URL scheme exists for third-party clients.

### 3.4 Third-party authorization for unattended use — `BLOCKED`

Meta Model API authenticates with a Bearer API key issued to a team. No OAuth
application registration, scope set or token exchange exists that would let a
local tool act on a personal Vibes account.

The only mechanism observed in the wild is reuse of a browser session cookie.
That is a credential-harvesting pattern, and this project will not implement it.

### 3.5 Free-plan quota — `UNVERIFIED`

Meta describes Vibes generation without publishing a quota table; per-account
limits appear inside the product UI. Because no API exists, a quota cannot be
read programmatically. The server reports `remaining: null` and explains why,
rather than guessing a number.

### 3.6 Video generation on Meta Model API — `NOT_SUPPORTED`

The published catalogue contains **no video-generation model**:

| Model | Output |
| --- | --- |
| `muse-wonder-1.0`, `muse-spark-1.3`, `muse-ember-1.0` | Text |
| `muse-image-1.0` | Image |
| `muse-voice-transcribe-1.0` | Text transcript |
| `sam-3.1` | Boxes and masks |
| `muse-spark-open`, `muse-glimmer` | Self-hosted weights |

Video appears only as an **input** modality, for understanding and segmentation.

> Video understanding and video segmentation must never be represented as video
> generation. Tracking objects across frames of an existing clip is analysis.

### 3.7 Image generation on Meta Model API — `OFFICIALLY_DOCUMENTED` but **paid**

`muse-image-1.0` is real, documented and supported:

- `POST https://api.meta.ai/v1/images/generations`
- `POST https://api.meta.ai/v1/images/edits`
- Responses API for multi-turn editing
- **$0.01 per generated image**, flat, pay-as-you-go

This is a genuine capability, and it is **excluded by design**. Constraint 2.1 of
the product brief forbids presenting Muse Image as the free Vibes generator, and
`ALLOW_PAID_PROVIDERS=true` is rejected at startup rather than silently billing
an account.

### 3.8 Free tier on Meta Model API — `NOT_SUPPORTED`

Billing is pay-as-you-go with no minimums, or a Muse Code subscription.
Contributor mode is a *discount* (content is used for training) — not a free
allowance. Sign-up documentation directs users to add a payment method before
making requests. Promotional credits are discretionary, not a standing offer.

---

## 4. Why the existing community clients were rejected

Several public projects do reach Vibes programmatically. Their own
documentation describes how, and that description is exactly why this project
does not use them:

- They were built by **reverse-engineering the Next.js bundles** and observing
  network traffic from the private web app.
- Authentication is a **copied `meta_session` browser cookie**, which expires
  after roughly an hour of use and must be re-grabbed from DevTools.
- They state plainly that **"all endpoints are private and could change at any
  time"** and that there is **"no public API"**.
- Other tools wrap the same approach in a browser extension.

Product brief section 2.4 forbids cookie extraction, undocumented endpoints and
consumer-interface automation. Section 2.3 forbids presenting such work as
sanctioned. Wrapping one of these clients would violate both, so Freevibes does
not implement, depend on, or copy endpoint knowledge from them.

A consequence worth stating: **a third-party client breaking is not a bug you
can report to Meta**, and using one puts the user's account at risk under
Vibes' terms.

---

## 5. Decision

Per the product brief's feasibility decision engine, this is **Outcome C —
BLOCKED** for the Vibes provider, with one clarifying note:

- Every Vibes modality is `BLOCKED`: image, video, image-to-video, retrieval,
  and third-party authorization.
- Meta Model API offers a documented image path, but it is paid and therefore
  outside free mode (`NOT_SUPPORTED` *for this product*).
- No modality is reported as `VERIFIED_WORKING`, because none was verified
  working through a permitted route.

Accordingly:

- The `meta-vibes-free` provider returns a structured `BLOCKED` result from every
  generation method. It sends no network request.
- No fake generation, no private endpoint calls, no browser bot, and no manual
  fallback is presented as the product.
- The reusable infrastructure — MCP server, tool contracts, orchestrator, job
  store, downloader, validator, asset manager, installer, tests, CI and docs —
  is complete and tested.
- **No production-ready claim is made for the Meta integration.**

---

## 6. What would change this verdict

Any one of these would move a modality from `BLOCKED` to buildable, and the
provider is structured so that adding one is a single adapter change:

1. Meta publishes a **documented generation API** with a sanctioned auth flow
   for individual accounts (OAuth client registration or a scoped API key).
2. Meta publishes **free-tier entitlements** on Meta Model API, making
   `muse-image-1.0` usable without billing.
3. Meta publishes a **video-generation model** on Meta Model API.
4. Meta explicitly authorizes unattended automation of the Vibes consumer
   interface in its terms, with a supported mechanism.

Until then, reporting the block is the correct behaviour, and the tests assert
it: see `test/provider.test.ts` and `test/mcp-server.test.ts`.

---

## 7. Keeping this current

Re-check on each release, or when Meta announces new developer capabilities:

1. Read `https://dev.meta.ai/docs/models` and confirm the catalogue.
2. Read `https://dev.meta.ai/docs/pricing-rate-limits` and confirm whether a free
   allowance exists.
3. Check the Vibes help centre for any mention of developer access.
4. Update `src/evidence.ts` and this file together, with a new `verifiedOn` date.

The server never reports a capability as usable from a stale row: a status only
counts as usable when it is `VERIFIED_WORKING` or
`OFFICIALLY_AUTHORIZED_AUTOMATION`.
