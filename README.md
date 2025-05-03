# Discorss: RSS feeds for Discord

Features:

- Add RSS feeds to any channel
- Automatically poll feeds and send new items to the channel
- Automatically summarize content
- Archive.is links for paywalled content
- Easy self hosting
- Free and open source
- Slash command native – no separate UI like monitorss

## Deployment

Fill the rest of the .env file.
After installing the dependencies, you also need to register the slash commands by running `pnpm commands:register`.

Setup a bot in the discord developer portal and put the token in for the `DISCORD_TOKEN` and the client id in for the `DISCORD_CLIENT_ID` variable.

Get a postgres compatible db url and put in for the `DATABASE_URL`.
You can use an external provider like [Neon](https://neon.tech/), or add a PostgreSQL service directly within your Railway project dashboard. Railway will automatically provide the `DATABASE_URL` environment variable.

For deployment, I'm deploying on [Railway](https://railway.com/). Deployment is very cheap.
