// Registers slash commands with Discord. Run with:
//   DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... bun run scripts/register-commands.ts
// (or `bun run commands:register` with a .env in this directory)

import { COMMAND_METADATA } from '../src/discord/command-metadata.js';

const clientId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!clientId || !botToken) {
    console.error('DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN must be set.');
    process.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/applications/${clientId}/commands`, {
    method: 'PUT',
    headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify(COMMAND_METADATA),
});

if (!res.ok) {
    console.error(`Failed to register commands (${res.status}):`, await res.text());
    process.exit(1);
}

const registered = (await res.json()) as Array<{ name: string }>;
console.log(`Registered ${registered.length} commands:`);
for (const cmd of registered) {
    console.log(`  - ${cmd.name}`);
}
