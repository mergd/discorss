# Discorss: RSS feeds for Discord

Features:

- Add RSS feeds to any channel
- Automatically poll feeds and send new items to the channel
- Automatically summarize content
- Archive.is links for paywalled content
- Free and open source
- Slash command native – no separate UI like MonitoRSS
- Runs entirely on Cloudflare Workers (interactions endpoint + cron + queue + D1) — no servers

## How it works

- Discord sends slash-command payloads over HTTP to the worker's `/interactions` endpoint.
- A cron trigger (every 2 minutes) selects feeds that are due and enqueues them; a queue
  consumer fetches, parses, optionally AI-summarizes, and posts new items via the Discord
  REST API.
- Feed configuration lives in Cloudflare D1. An admin UI (`admin/`) is served as worker
  assets with Discord OAuth.

## Deployment

See [`workers/bot/README.md`](workers/bot/README.md) for full setup: creating the D1
database and queue, setting secrets, deploying, registering commands, and pointing the
Discord Interactions Endpoint URL at the worker.

The original Node.js/discord.js/Postgres implementation (self-hostable via Docker) lives in
git history prior to July 2026.
