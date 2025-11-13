# Dockerfile

# ---- Base Stage ----
# Use Bun's official image
FROM oven/bun:1 AS base

WORKDIR /usr/src/app

# ---- Dependencies Stage ----
# Install dependencies separately to leverage Docker cache
FROM base AS deps

# Copy package.json and optionally the bun lockfile
COPY package.json ./
COPY bun.lockb* ./
# Install all dependencies (including devDependencies needed for build)
RUN bun install

# ---- Build Stage ----
# Build the TypeScript application
FROM base AS build

# Copy dependencies from the 'deps' stage
COPY --from=deps /usr/src/app/node_modules ./node_modules
# Copy the rest of the application source code
COPY . .
# Run the build script defined in package.json
RUN bun run build

# ---- Production Stage ----
# Create the final, smaller production image
FROM base

WORKDIR /usr/src/app

# Copy essential files for running the application
COPY package.json ./
COPY bun.lockb* ./
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY config ./config
COPY lang ./lang
# Copy drizzle config needed for migrations
COPY src/drizzle.config.ts ./src/drizzle.config.ts
COPY drizzle/migrations ./drizzle/migrations
# Copy cron restart script (if using same image for cron service)
COPY cron-restart.js ./
# Define the command to run migrations, register commands, and then start the app
# Run migrations first, then register commands, and finally start the app
CMD ["sh", "-c", "bun run db:migrate && bun --enable-source-maps dist/start-bot.js commands register && bun dist/start-manager.js"]

# Optional: Expose the API port if used (check config/config.json)
# Default from template might be 3000 or similar
# EXPOSE 3000
