# Claude AI Context for Discorss Bot

## Project Overview
This is a Discord RSS bot called "Discorss" that automatically polls RSS feeds and posts new items to Discord channels with AI-powered summarization capabilities.

## Key Features
- RSS feed polling and Discord integration
- AI-powered content summarization  
- Archive.is integration for paywalled content
- Slash command interface
- Multi-shard architecture with cluster management

## Technology Stack
- **Runtime**: Node.js 18+ with TypeScript
- **Discord**: discord.js v14 with hybrid sharding
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI API for content summarization
- **Package Manager**: pnpm
- **Testing**: Vitest

## Project Structure
- `/src/` - Main source code
  - `/commands/` - Discord slash commands
  - `/events/` - Discord event handlers  
  - `/jobs/` - Background jobs (feed polling)
  - `/services/` - Core business logic
  - `/utils/` - Utility functions
  - `/db/` - Database schema and connection
- `/config/` - Configuration files
- `/drizzle/` - Database migrations
- `/tests/` - Test files

## Important Scripts
```bash
# Development
pnpm build                # Compile TypeScript
pnpm lint                 # Run ESLint
pnpm test                 # Run tests
pnpm start               # Start the manager (default)
pnpm start:bot           # Start single bot instance
pnpm start:manager       # Start cluster manager

# Database
pnpm db:generate         # Generate migrations
pnpm db:push            # Push schema changes
pnpm db:migrate         # Run migrations
pnpm db:studio          # Open Drizzle Studio

# Discord Commands
pnpm commands:register   # Register slash commands
pnpm commands:view      # View registered commands
pnpm commands:delete    # Delete commands
```

## Key Constants (src/constants/misc.ts)
- `MAX_ITEM_HOURS`: Maximum age for feed items to be processed (replaces MAX_ITEM_AGE_DAYS)
- `DEFAULT_FREQUENCY_MINUTES`: Default polling frequency
- `MAX_FREQUENCY_MINUTES`: Maximum allowed polling frequency
- `MIN_FREQUENCY_MINUTES`: Minimum allowed polling frequency

## Development Notes
- Uses ES modules (`"type": "module"` in package.json)
- TypeScript with strict configuration
- Code follows ESLint and Prettier formatting
- Environment variables loaded via dotenv
- Analytics via PostHog
- Error handling with exponential backoff for feed failures

## Database Schema
Located in `src/db/schema.ts` - uses Drizzle ORM with PostgreSQL for storing feed configurations, guild settings, and processed items.

## Testing
- Unit tests in `/tests/` directory
- Uses Vitest as test runner
- Coverage reports available via `pnpm test:coverage`

## Docker Support
- Docker Compose configuration available
- Supports both local and external PostgreSQL databases
- Use `--profile localdb` for local database setup