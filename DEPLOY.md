# Moltworker Deployment Guide

## Quick Deploy (Recommended)

```bash
cd /root/clawd/agents/researcher/instantagent/moltworker
./deploy.sh
```

The deploy script automatically:
1. Cleans up old container images (keeps 3 most recent)
2. Builds the project
3. Deploys to Cloudflare

---

## Manual Deploy

If needed, you can deploy manually:

```bash
# Set API token
export CLOUDFLARE_API_TOKEN="your-token-here"

# Build
npm run build

# Deploy
npx wrangler deploy
```

---

## Troubleshooting

### "ENOSPC: no space left on device" Error

Cloudflare has a 50GB limit on container image storage. Old images accumulate and fill this up.

**Fix:** Delete old images before deploying:

```bash
# List images
npx wrangler containers images list

# Delete old ones (one at a time)
npx wrangler containers images delete instantagent-sandbox-sandbox:<tag>
```

Or just use `./deploy.sh` which does this automatically.

### Container Build Fails

1. Check Dockerfile syntax
2. Verify base image is available
3. Check if npm packages can be installed

### "Invalid or missing token" WebSocket Error

The Moltbot gateway requires a token. Options:
1. Set `MOLTBOT_GATEWAY_TOKEN` secret in Cloudflare
2. Visit the URL with `?token=YOUR_TOKEN`
3. In DEV_MODE, the Worker now auto-injects the token

---

## Configuration

### Environment Variables (wrangler.jsonc)

```jsonc
{
  "vars": {
    "WORKER_URL": "https://instantagent-sandbox.nate-f38.workers.dev",
    "DEV_MODE": "true",
    "DEBUG_ROUTES": "true"
  }
}
```

### Secrets (via `wrangler secret put`)

| Secret | Required | Purpose |
|--------|----------|---------|
| `ANTHROPIC_API_KEY` | No* | AI provider key |
| `MOLTBOT_GATEWAY_TOKEN` | No | Protect gateway access |
| `R2_ACCESS_KEY_ID` | For persistence | R2 storage |
| `R2_SECRET_ACCESS_KEY` | For persistence | R2 storage |
| `CF_ACCOUNT_ID` | For persistence | R2 endpoint URL |

*Workers AI is used as fallback if no API keys are set.

### Container Settings

- **Instance type:** standard-4 (4 vCPU, 12 GiB RAM, 20 GB disk)
- **Image storage limit:** 50 GB per account
- **Max instances:** 3

---

## Files

| File | Purpose |
|------|---------|
| `deploy.sh` | Auto-cleanup deploy script |
| `Dockerfile` | Container image definition |
| `wrangler.jsonc` | Worker configuration |
| `start-moltbot.sh` | Container startup script |
| `src/index.ts` | Worker entry point |

---

*Last updated: 2026-02-03*
