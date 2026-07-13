# Potbelly operations runbook

## One-time Cloudflare setup

1. Create Pages projects `potbelly-staging` and `potbelly` using Direct Upload.
2. Add `potbelly.redcliffebay.com` as the production Pages custom domain.
3. Add GitHub secrets `CLOUDFLARE_ACCOUNT_ID` and a least-privilege `CLOUDFLARE_API_TOKEN` with Pages and Workers deployment access.
4. Add repository variable `POTBELLY_STAGING_URL` with the staging HTTPS origin.
5. Create protected GitHub environments `staging`, `production`, and `corpus-production`; require manual approval for production.
6. Run `pnpm worker:deploy:staging` and `pnpm worker:deploy:production` once to create the Workers and quota Durable Objects.
7. Add the Worker route `potbelly.redcliffebay.com/api/*` if Wrangler has not created it automatically.
8. Enable GitHub secret scanning and require the validation workflow on `main`.

Until `CLOUDFLARE_API_TOKEN` exists, keep the repository variable `CLOUDFLARE_DEPLOY_ENABLED=false`. GitHub Actions still validates every push but intentionally skips deployment jobs. After adding the token, set the variable to `true`. Local OAuth may be used for the first staging deployment only.

## AI secrets

Apply the OpenAI credential and an independent random rate-limit hashing secret separately to staging and production:

```sh
pnpm exec wrangler secret put OPENAI_API_KEY --config worker/wrangler.jsonc --env staging
pnpm exec wrangler secret put AI_RATE_LIMIT_HASH_SECRET --config worker/wrangler.jsonc --env staging
```

Repeat with `--env production`. Do not add values to GitHub, Pages variables, source files, browser assets, or logs.
The public assistant has no PIN or sign-in. The Worker still requires same-origin requests, short-lived browser credentials, privacy-preserving identifiers, and strict daily quotas.

Keep `AI_ENABLED=false` during initial staging. Enable only after the voice evaluation corpus passes:

```sh
pnpm exec wrangler secret put AI_ENABLED --config worker/wrangler.jsonc --env staging
```

Enter `true` when prompted. Use the same command with `false` as the emergency kill switch.

## Normal release

1. Run `pnpm verify` locally.
2. Commit a Conventional Commit directly to `main`.
3. Push `main`.
4. Confirm validate, staging, and verify-staging are green.
5. Approve the production environment.
6. Confirm `/`, one recipe, one PDF, `manifest.webmanifest`, `sw.js`, and `pnpm verify:ai-health`.
7. Cold-launch the Home Screen app in airplane mode before declaring the release complete.

## Rollback

For static regressions, redeploy the previous immutable Pages deployment in Cloudflare. For API regressions, use Workers Deployments to roll back the Worker version. Set `AI_ENABLED=false` immediately for unexpected OpenAI cost, unsafe behaviour, credential trouble, or sustained provider failures; the offline cookbook remains operational.

## Monitoring and privacy

- Weekly GitHub health workflow: live browser flow and source-link audit.
- OpenAI project: usage alerts and a hard monthly budget.
- Cloudflare: Worker errors, AI session failures, quota spikes, and provider failures.
- Logs: request ID, endpoint, status, and latency only.
- Never log raw IP addresses, device IDs, recipe progress, microphone audio, questions, responses, or ephemeral credentials.

## Physical-iPad gate

- Correct Home Screen icon and standalone window.
- Airplane-mode launch, search, recipes, and Cooking Mode.
- Portrait, landscape, and Split View.
- Checklist persistence after termination.
- Software and hardware keyboards.
- Microphone permission, mute, interruption, background disconnect, AirPods, and built-in speaker.
- VoiceOver, Larger Text, zoom, contrast, and Reduced Motion.
- Update prompt while a recipe is active.
- AI failure or kill switch without loss of recipe access or local progress.
