# Claude AI Context for Discorss Bot

## Project Overview
Discorss is a Discord RSS bot that polls RSS feeds and posts new items to Discord channels with
AI-powered summarization. It runs entirely on Cloudflare Workers — no servers.

## Architecture (`workers/bot/`)
- **HTTP interactions** — Discord POSTs slash-command payloads to `/interactions` (Ed25519-verified); no gateway, no discord.js.
- **Cron Trigger** (every 2 min) — selects due feeds from D1 and enqueues them.
- **Queue** (`discorss-feeds`) — consumer fetches/parses feeds, summarizes via OpenRouter, posts items over the Discord REST API.
- **D1** (`discorss` database, `DB` binding) — schema in `workers/bot/migrations/0001_init.sql`; timestamps are epoch ms, booleans 0/1.
- **Admin UI** — Vite/React app in `admin/`, served as worker assets; `/api` + `/auth` are Hono routes with Discord OAuth.

## Structure
- `workers/bot/src/` — the worker
  - `interactions/` — command handlers + button components (deferred replies via `ctx.waitUntil`)
  - `feeds/` — scheduler, poller, RSS fetch/parse, summarizer
  - `discord/` — REST client, interaction types, Ed25519 verify, command metadata
  - `services/feed-storage.ts` — all DB access (via `getDb()`/`runWithDb`)
  - `admin/` — Hono admin API
- `workers/bot/scripts/` — command registration, Postgres→D1 export (historical)
- `admin/` — admin UI (PandaCSS + Base UI)

## Commands (run in `workers/bot/`)
```bash
bun run dev            # wrangler dev
bun run typecheck
bun run deploy         # build admin first: cd admin && bun run build
bun run commands:register   # needs DISCORD_CLIENT_ID / DISCORD_BOT_TOKEN env
```

## Notes
- Package manager: bun. TypeScript strict. No `any`.
- Secrets via `wrangler secret put` — list in `workers/bot/wrangler.jsonc` comments.
- The pre-2026 Node.js/discord.js/Postgres implementation was deleted after cutover
  (July 2026); see git history if needed.
