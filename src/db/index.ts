import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required.');
}

console.log('[DB] Using PostgreSQL');
const connectionString = process.env.DATABASE_URL;
const pgClient = postgres(connectionString, {
    ssl: connectionString.includes('sslmode=require') ? 'require' : undefined,
    max: 5, // Increase connection pool size
    idle_timeout: 20, // Close idle connections after 20 seconds
    max_lifetime: 60 * 30, // Close connections after 30 minutes
});
const dbInstance = drizzlePg(pgClient, { schema, logger: true });

export const db = dbInstance;

// Export schema for easy access
export * from './schema.js';
