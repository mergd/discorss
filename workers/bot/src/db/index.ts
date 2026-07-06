import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import type { Env } from '../env.js';
import * as schema from './schema.js';

export type Db = DrizzleD1Database<typeof schema>;

const dbStorage = new AsyncLocalStorage<Db>();

/**
 * Runs `fn` with the D1-backed database bound to the async context. D1 is a
 * binding (no TCP sockets), so unlike the old Postgres client there is nothing
 * to open or close per invocation — this wrapper just keeps getDb() working
 * everywhere without threading `env` through every call site.
 */
export async function runWithDb<T>(env: Env, fn: () => Promise<T>): Promise<T> {
    const db = drizzle(env.DB, { schema });
    return dbStorage.run(db, fn);
}

export function getDb(): Db {
    const db = dbStorage.getStore();
    if (!db) {
        throw new Error('getDb() called outside runWithDb()');
    }
    return db;
}

export * from './schema.js';
