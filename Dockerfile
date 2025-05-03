# Dockerfile

# ---- Base Stage ----
# Use a Node.js base image (e.g., Node 20 Slim)
FROM node:20-slim AS base

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /usr/src/app

# ---- Dependencies Stage ----
# Install dependencies separately to leverage Docker cache
FROM base AS deps

# Copy package.json and the pnpm lockfile
COPY package.json pnpm-lock.yaml ./
# Install all dependencies (including devDependencies needed for build)
# Use --frozen-lockfile for reproducible installs
RUN pnpm install --frozen-lockfile

# ---- Build Stage ----
# Build the TypeScript application
FROM base AS build

# Copy dependencies from the 'deps' stage
COPY --from=deps /usr/src/app/node_modules ./node_modules
# Copy the rest of the application source code
COPY . .
# Run the build script defined in package.json
RUN pnpm run build

# ---- Production Stage ----
# Create the final, smaller production image
FROM base

WORKDIR /usr/src/app

# Copy essential files for running the application
COPY package.json pnpm-lock.yaml ./
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY config ./config
COPY lang ./lang
# Copy drizzle config needed for migrations
COPY src/drizzle.config.ts ./src/drizzle.config.ts
COPY drizzle/migrations ./drizzle/migrations
# Define the command to run migrations, register commands, and then start the app
# Use npx to run drizzle-kit from node_modules/.bin
# Use sh -c to chain commands
CMD ["sh", "-c", "npx drizzle-kit migrate --config=src/drizzle.config.ts && node --enable-source-maps dist/start-bot.js commands register && node dist/start-manager.js"]

# Optional: Expose the API port if used (check config/config.json)
# Default from template might be 3000 or similar
# EXPOSE 3000
