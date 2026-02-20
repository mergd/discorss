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

# Set production environment
ENV NODE_ENV=production

# Define the command to run migrations, register commands, and then start the app
# --smol: Bun's memory-optimized mode for lower memory usage
# Single-process mode avoids ShardingManager process overhead for small bots.
CMD ["sh", "-c", "bun run db:migrate && bun dist/start-bot.js commands register && bun --smol dist/start-bot.js"]

# Expose the API port for healthchecks
EXPOSE 3001
