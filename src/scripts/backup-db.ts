import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from '../db/schema.js';

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required.');
}

const connectionString = process.env.DATABASE_URL;
const pgClient = postgres(connectionString, {
    ssl: connectionString.includes('sslmode=require') ? 'require' : undefined,
    max: 1,
});
const db = drizzle(pgClient, { schema });

async function backupData() {
    try {
        console.log('🔄 Starting database backup...');

        // Create backup directory
        const backupDir = path.join(process.cwd(), 'data/backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `database-backup-${timestamp}.json`);

        // Get all table names from schema
        const tableNames = Object.keys(schema).filter(
            key => schema[key] && typeof schema[key] === 'object' && 'getSQL' in schema[key]
        );

        const backup = {};

        // Export data from each table
        for (const tableName of tableNames) {
            try {
                console.log(`📦 Backing up table: ${tableName}`);
                const table = schema[tableName];
                const data = await db.select().from(table);
                backup[tableName] = data;
                console.log(`✅ Backed up ${data.length} records from ${tableName}`);
            } catch (error) {
                console.warn(`⚠️  Could not backup table ${tableName}:`, error.message);
                backup[tableName] = [];
            }
        }

        // Write backup to file
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
        console.log(`✅ Backup completed: ${backupFile}`);

        // Close connection
        await pgClient.end();
    } catch (error) {
        console.error('❌ Backup failed:', error);
        process.exit(1);
    }
}

backupData();
