#!/usr/bin/env node
/**
 * Railway Cron Service - Bot Restarter
 * 
 * This script is meant to be deployed as a SEPARATE Railway service
 * with a cron schedule (e.g., "0 */12 * * *" for every 12 hours).
 * 
 * It restarts the main bot service via Railway's API, then exits.
 */

const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;
const SERVICE_ID = process.env.BOT_SERVICE_ID;

if (!RAILWAY_API_TOKEN || !SERVICE_ID) {
    console.error('Error: RAILWAY_API_TOKEN and BOT_SERVICE_ID must be set');
    process.exit(1);
}

async function restartBotService() {
    console.log(`[${new Date().toISOString()}] Triggering restart of bot service: ${SERVICE_ID}`);

    const mutation = `
        mutation serviceInstanceRedeploy($serviceId: String!) {
            serviceInstanceRedeploy(serviceId: $serviceId)
        }
    `;

    try {
        const response = await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
            },
            body: JSON.stringify({
                query: mutation,
                variables: {
                    serviceId: SERVICE_ID,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`Railway API returned ${response.status}: ${await response.text()}`);
        }

        const result = await response.json();

        if (result.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        }

        console.log(`[${new Date().toISOString()}] Successfully triggered restart`);
        console.log('Result:', result.data);
        process.exit(0);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Failed to restart bot:`, error);
        process.exit(1);
    }
}

restartBotService();

