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
    max: 3, // Reduce connection pool size to save memory
    idle_timeout: 10, // Close idle connections after 10 seconds
    max_lifetime: 60 * 15, // Close connections after 15 minutes
    connect_timeout: 30, // 30 second connection timeout
    prepare: false, // Disable prepared statements to reduce memory
});
const dbInstance = drizzlePg(pgClient, { schema, logger: true });

export const db = dbInstance;

// Export schema for easy access
export * from './schema.js';
