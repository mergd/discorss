# Discorss: RSS feeds for Discord

Features:

- Add RSS feeds to any channel
- Automatically poll feeds and send new items to the channel
- Automatically summarize content
- Archive.is links for paywalled content
- Easy self hosting
- Free and open source
- Slash command native – no separate UI like MonitoRSS

## Deployment

Fill out the `.env` file with your configuration.
After installing dependencies, register the slash commands by running `pnpm commands:register`.

Set up a bot in the Discord developer portal and put the token in for the `DISCORD_BOT_TOKEN` and the client id in for the `DISCORD_CLIENT_ID` variable.

Get a Postgres-compatible database URL and set it as `DATABASE_URL` in your `.env`. You can use an external provider like [Neon](https://neon.tech/) or add a PostgreSQL service directly within your Railway project dashboard. Railway will automatically provide the `DATABASE_URL` environment variable.

### Docker Compose (with optional local Postgres)

This project uses Docker Compose profiles to make the local Postgres database optional.

- **To use a local Postgres database:**

    ```sh
    docker-compose up --profile localdb
    ```

    This starts both the bot and a local Postgres service. The bot will connect to the local database by default.

- **To use an external database (e.g., Neon, Railway):**
    ```sh
    docker-compose up
    ```
    This starts only the bot service. Make sure your `.env` contains a valid external `DATABASE_URL`.

For deployment, you can use [Railway](https://railway.com/) or any other platform that supports Docker or Node.js.
