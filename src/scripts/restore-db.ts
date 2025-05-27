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

// Define which fields are dates for each table
const dateFields = {
    feeds: ['lastChecked', 'createdAt', 'lastFailureNotificationAt', 'backoffUntil'],
    feedFailures: ['timestamp'],
    categories: [], // No date fields in categories
};

// Define table restoration order to handle foreign key dependencies
const tableOrder = [
    'categories', // No dependencies
    'feeds', // May reference categories
    'feedFailures', // References feeds
];

// Define upsert strategies for each table
const upsertConfig = {
    categories: {
        target: ['guildId', 'nameLower'], // Unique constraint
        set: ['name', 'frequencyMinutes'], // Fields to update on conflict
    },
    feeds: {
        target: ['id'], // Primary key
        set: [
            'url',
            'channelId',
            'guildId',
            'nickname',
            'category',
            'addedBy',
            'frequencyOverrideMinutes',
            'lastChecked',
            'lastItemGuid',
            'consecutiveFailures',
            'summarize',
            'lastArticleSummary',
            'lastCommentsSummary',
            'recentLinks',
            'lastFailureNotificationAt',
            'backoffUntil',
        ],
    },
    feedFailures: {
        target: ['id'], // Primary key
        set: ['feedId', 'timestamp', 'errorMessage'],
    },
};

function convertDates(tableName: string, record: any): any {
    const fieldsToConvert = dateFields[tableName] || [];
    const converted = { ...record };

    for (const field of fieldsToConvert) {
        if (converted[field] && typeof converted[field] === 'string') {
            converted[field] = new Date(converted[field]);
        }
    }

    return converted;
}

async function upsertBatch(tableName: string, table: any, batch: any[]) {
    const config = upsertConfig[tableName];

    if (!config) {
        // Fallback to regular insert if no upsert config
        await db.insert(table).values(batch);
        return;
    }

    // Insert records one by one to handle upserts properly
    for (const record of batch) {
        try {
            if (tableName === 'feeds') {
                await db
                    .insert(schema.feeds)
                    .values(record)
                    .onConflictDoUpdate({
                        target: [schema.feeds.id],
                        set: {
                            url: record.url,
                            channelId: record.channelId,
                            guildId: record.guildId,
                            nickname: record.nickname,
                            category: record.category,
                            addedBy: record.addedBy,
                            frequencyOverrideMinutes: record.frequencyOverrideMinutes,
                            lastChecked: record.lastChecked,
                            lastItemGuid: record.lastItemGuid,
                            consecutiveFailures: record.consecutiveFailures,
                            summarize: record.summarize,
                            lastArticleSummary: record.lastArticleSummary,
                            lastCommentsSummary: record.lastCommentsSummary,
                            recentLinks: record.recentLinks,
                            lastFailureNotificationAt: record.lastFailureNotificationAt,
                            backoffUntil: record.backoffUntil,
                        },
                    });
            } else if (tableName === 'feedFailures') {
                await db
                    .insert(schema.feedFailures)
                    .values(record)
                    .onConflictDoUpdate({
                        target: [schema.feedFailures.id],
                        set: {
                            feedId: record.feedId,
                            timestamp: record.timestamp,
                            errorMessage: record.errorMessage,
                        },
                    });
            } else if (tableName === 'categories') {
                await db
                    .insert(schema.categories)
                    .values(record)
                    .onConflictDoUpdate({
                        target: [schema.categories.guildId, schema.categories.nameLower],
                        set: {
                            name: record.name,
                            frequencyMinutes: record.frequencyMinutes,
                        },
                    });
            } else {
                // Fallback to regular insert
                await db.insert(table).values(record);
            }
        } catch (error) {
            console.error(`Error upserting record in ${tableName}:`, error.message);
            console.error('Record:', JSON.stringify(record, null, 2));
            throw error;
        }
    }
}

async function restoreData() {
    try {
        // Get backup file from command line argument or find the latest one
        const backupFile = process.argv[2] || findLatestBackup();

        if (!backupFile || !fs.existsSync(backupFile)) {
            throw new Error(`Backup file not found: ${backupFile}`);
        }

        console.log(`🔄 Starting database restore from: ${backupFile}`);

        // Read backup data
        const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

        // Get tables in dependency order, only including tables that exist in backup
        const tablesToRestore = tableOrder.filter(
            tableName => backupData[tableName] && Array.isArray(backupData[tableName])
        );

        console.log(`📋 Found ${tablesToRestore.length} tables to restore in dependency order`);
        console.log(`🔄 Using upsert strategy - safe to run multiple times`);

        // Restore data to each table in the correct order
        for (const tableName of tablesToRestore) {
            try {
                const tableData = backupData[tableName];

                if (tableData.length === 0) {
                    console.log(`ℹ️  No data to restore for table: ${tableName}`);
                    continue;
                }

                console.log(`🔄 Upserting table: ${tableName} (${tableData.length} records)`);

                const table = schema[tableName];
                if (!table) {
                    console.warn(`⚠️  Table ${tableName} not found in schema, skipping`);
                    continue;
                }

                // Convert date strings back to Date objects
                const convertedData = tableData.map(record => convertDates(tableName, record));

                // Upsert data in smaller batches (since we're doing individual upserts)
                const batchSize = 50;
                for (let i = 0; i < convertedData.length; i += batchSize) {
                    const batch = convertedData.slice(i, i + batchSize);
                    await upsertBatch(tableName, table, batch);
                    console.log(
                        `   📦 Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(convertedData.length / batchSize)}`
                    );
                }

                console.log(`✅ Upserted ${convertedData.length} records to ${tableName}`);
            } catch (error) {
                console.error(`❌ Failed to upsert table ${tableName}:`, error.message);
                // For foreign key errors, this is critical - stop the process
                if (
                    error.message.includes('foreign key constraint') ||
                    error.message.includes('violates')
                ) {
                    console.error('🛑 Foreign key constraint violation - stopping restore process');
                    throw error;
                }
            }
        }

        console.log('🎉 Database restore completed!');
        console.log('✅ Safe to run again - all operations were upserts');

        // Close connection
        await pgClient.end();
    } catch (error) {
        console.error('❌ Restore failed:', error);
        process.exit(1);
    }
}

function findLatestBackup(): string | null {
    const backupDir = path.join(process.cwd(), 'data/backups');

    if (!fs.existsSync(backupDir)) {
        return null;
    }

    const backupFiles = fs
        .readdirSync(backupDir)
        .filter(file => file.startsWith('database-backup-') && file.endsWith('.json'))
        .map(file => ({
            name: file,
            path: path.join(backupDir, file),
            mtime: fs.statSync(path.join(backupDir, file)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return backupFiles.length > 0 ? backupFiles[0].path : null;
}

restoreData();
