# Potbelly

Potbelly is an iPad-first, offline-capable Instant Pot cookbook. It turns a validated
JSON corpus into searchable recipe pages, guided Cooking Mode, typeset A4 PDFs, and
an optional realtime voice cooking assistant.

## Architecture

```text
Validated data.json → Python HTML/PDF generation → strict TypeScript/Vite assets
→ Workbox offline shell → Cloudflare Pages staging → browser/iPad gates → production
```

`data.json` remains the production recipe source of truth. `dist/` is generated and
must not be edited manually. IndexedDB stores local cooking progress. The public
cookbook and AI assistant need no login.

The Cloudflare Worker validates requests, enforces per-device and per-IP quotas with a
Durable Object, and creates short-lived OpenAI Realtime client secrets. The permanent
API key never enters the browser. Microphone audio travels directly from the browser to
OpenAI over WebRTC; Potbelly does not display or deliberately retain a transcript.

## Local development

Requirements: Node 22+, pnpm 10+, Python 3.13+, and Homebrew Pango/GLib on macOS.

```sh
pnpm install
pnpm setup:python
pnpm verify
```

The local build defaults to `http://127.0.0.1:4173`. Production and preview builds
must set `SITE_URL` to the canonical HTTPS hostname.

Key commands:

- `pnpm check` — Python syntax and corpus contract.
- `pnpm test` — unit, security, collision, and atomic-build regressions.
- `pnpm build` — Vite assets, atomic HTML/PDF generation, and service-worker injection.
- `pnpm verify:links` — generated `dist/` route and asset audit.
- `pnpm test:e2e` — Playwright interaction, mobile, CSP, and axe checks.
- `pnpm verify` — complete local release gate.

## Release model

Only GitHub Actions may promote production. A main push validates one immutable
artifact, deploys it to Cloudflare staging, tests it, and then promotes that exact
artifact through the protected production environment.

Release A contains the hardened 18-recipe baseline. Release B may promote only when
`pipeline:validate-output` reports exactly 150 unique recipes.

See [docs/runbook.md](docs/runbook.md) for setup, monitoring, and rollback. See
[pipeline/README.md](pipeline/README.md) for corpus operations.
