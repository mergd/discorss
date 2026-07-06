# Discorss on Cloudflare Workers

Serverless port of the Discorss bot. Replaces the gateway/sharding architecture with:

- **HTTP interactions** — Discord POSTs slash-command payloads to `/interactions` (no WebSocket, no discord.js, no sharding).
- **Cron Trigger** (every 2 min) — selects feeds that are due (`lastChecked` + effective frequency, respecting backoff) and enqueues them.
- **Cloudflare Queue** (`discorss-feeds`) — consumer fetches/parses each feed, generates AI summaries, and posts items via the Discord REST API.
- **Admin UI** — the Vite build in `../../admin/dist` is served as static assets; the `/api` + `/auth` endpoints are ported to Hono.

Feature changes vs. the Node bot:

- `/feed list` pagination uses **buttons** instead of reactions (reactions require the gateway).
- The `@mention → help` reply is gone (gateway-only, message-content intent).
- The `workers/rss-fetch` proxy worker is no longer needed — this worker already egresses from Cloudflare.
- All memory-management machinery (OOM restarts, RSS throttling, parser resets) is gone; every invocation starts fresh.

## Deploy

```bash
cd workers/bot
bun install

# Build the admin UI (served as worker assets)
cd ../../admin && bun install && bun run build && cd ../workers/bot

# Secrets
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_CLIENT_ID
wrangler secret put DISCORD_PUBLIC_KEY    # General Information page of the Discord app
wrangler secret put DEVELOPER_IDS         # comma-separated user IDs
# Optional:
wrangler secret put OPENROUTER_API_KEY    # or OPENAI_API_KEY (summarization)
wrangler secret put FEEDBACK_WEBHOOK_URL
wrangler secret put POSTHOG_API_KEY
wrangler secret put DISCORD_CLIENT_SECRET       # admin UI OAuth
wrangler secret put ADMIN_SESSION_SECRET        # admin UI sessions (random string)
wrangler secret put ADMIN_OAUTH_REDIRECT_URI    # https://<worker-domain>/auth/callback

# Create the queue, then deploy
wrangler queues create discorss-feeds
wrangler deploy
```

Then in the [Discord developer portal](https://discord.com/developers/applications):

1. Set **Interactions Endpoint URL** to `https://<worker-domain>/interactions`. Discord sends a PING to verify — the worker must be deployed with `DISCORD_PUBLIC_KEY` first.
2. Register slash commands:

```bash
DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... bun run commands:register
```

### Database (D1)

The worker uses Cloudflare D1 (`discorss` database, `DB` binding) — no external Postgres. The
SQLite schema lives in `migrations/0001_init.sql` (apply with `bun run db:migrate`). Timestamps
are stored as epoch milliseconds and booleans as 0/1; drizzle's `sqlite-core` schema in
`src/db/schema.ts` maps them back to `Date`/`boolean`.

Data comes from the old Postgres database via a snapshot:

```bash
bun run db:snapshot        # reads DATABASE_URL from ../../.env, writes migrations/data-snapshot.sql
bun run db:load-snapshot   # loads it into remote D1 (replaces existing rows)
```

The snapshot is a full replace, so re-run both commands at cutover time to capture rows written
by the Node bot in the meantime.

### Cutover from the Node bot

1. Deploy the worker + set secrets (bot keeps running on the gateway meanwhile).
2. Register commands (idempotent; definitions are equivalent).
3. Re-run `db:snapshot` + `db:load-snapshot` for a fresh copy of the data.
4. Set the Interactions Endpoint URL — from this moment slash commands are handled by the worker.
5. Stop the Node bot/container. Feed polling continues via the cron trigger against D1.
6. Optionally delete the `discorss-rss-fetch` worker and decommission the Postgres database.

## Local dev

```bash
# .dev.vars with the secrets above, then:
wrangler dev
# Trigger the cron locally:
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```
