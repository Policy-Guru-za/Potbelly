# Potbelly corpus pipeline

The corpus workflow is an editorial production process, not part of site deployment.
It crawls allowlisted recipe publishers, extracts Schema.org data, selects candidates,
rewrites methods through Claude, validates fidelity, and produces a candidate corpus.

## Quality contract

- Automated additions: rating at least 4.6 with at least 30 ratings.
- Thin-category backfill: rating at least 4.6 with at least 10 ratings.
- Maximum 20 recipes per publisher and 24 per category.
- Stable source identity: SHA-256-derived `source_id` from canonical HTTPS URL.
- Unique public routes; cross-publisher path collisions receive host suffixes.
- Exact preservation of every numeric token in source instructions.
- No non-factual eight-word overlap with source instructions.
- Versioned schema validation and exactly 150 unique records before promotion.

Six original production recipes are explicitly classified as `legacy`; they remain
published for route stability. The automated gate applies to all new recipes.

## Setup

From the repository root:

```sh
pnpm install
pnpm setup:python
export ANTHROPIC_API_KEY=...  # shell or protected GitHub environment only
```

Never commit or print the API key.

## Workflow

```sh
pnpm pipeline:dry-run          # cached crawl/extract/select; no model calls
pnpm pipeline:migrate-cache    # preview legacy cache-key migration
pnpm pipeline:expand           # rewrite/backfill until target or candidates exhaust
pnpm pipeline:validate-output  # must report exactly 150 before promotion
```

The generated files live under `pipeline/out/`. `data.validated.json` is a candidate
artifact. Promotion is a deliberate copy/review step into root `data.json`, followed
by the complete `pnpm verify` gate and a Vercel preview.

## Failure behavior

- Network 408/429/5xx failures receive bounded exponential retries.
- Extraction failures are structured warnings containing URL and error class.
- Rewrite failures remain in `report.txt`; reserve candidates backfill them.
- Cache identity mismatches, duplicate identities/routes, unsafe URLs, invalid schema,
  and target underfill fail closed.
- `attempted.json` and `report.txt` provide the audit trail for editorial review.
