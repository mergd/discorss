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
    max: 1,
});
const dbInstance = drizzlePg(pgClient, { schema, logger: true });

export const db = dbInstance;

// Export schema for easy access
export * from './schema.js';
