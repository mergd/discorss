import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';
import { createRequire } from 'node:module';

import { EventData } from '../../models/internal-models.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

const require = createRequire(import.meta.url);

interface ReleaseNote {
    version: string;
    date: string;
    title: string;
    features?: string[];
    improvements?: string[];
    bugfixes?: string[];
    url?: string;
}

export class ReleaseNotesCommand implements Command {
    public names = ['releasenotes'];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = ['SendMessages', 'EmbedLinks'];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        try {
            const releaseNotes: ReleaseNote[] = require('../../../config/release-notes.json');

            if (!releaseNotes || releaseNotes.length === 0) {
                await InteractionUtils.send(
                    intr,
                    'No release notes available yet. Check back later!',
                    true
                );
                return;
            }

            const latestRelease = releaseNotes[0];
            const description = this.buildReleaseDescription(latestRelease);

            const embed = new EmbedBuilder()
                .setTitle(`Release Notes: ${latestRelease.title || latestRelease.version}`)
                .setDescription(description)
                .setColor('Blurple')
                .setTimestamp(new Date(latestRelease.date));

            if (latestRelease.url) {
                embed.setURL(latestRelease.url);
            }

            if (releaseNotes.length > 1) {
                const previousReleases = releaseNotes
                    .slice(1, 6)
                    .map(release => {
                        const displayName = release.title || release.version;
                        return release.url
                            ? `[${displayName}](${release.url})`
                            : `**${displayName}**`;
                    })
                    .join('\n');

                if (previousReleases) {
                    embed.addFields({
                        name: 'Previous Releases',
                        value: previousReleases,
                    });
                }
            }

            await InteractionUtils.send(intr, { embeds: [embed] });
        } catch (error) {
            await InteractionUtils.send(
                intr,
                'Unable to load release notes at this time.',
                true
            );
        }
    }

    private buildReleaseDescription(release: ReleaseNote): string {
        const parts: string[] = [];

        if (release.version) {
            parts.push(`**Version:** ${release.version}`);
        }

        if (release.features && release.features.length > 0) {
            parts.push('\n**New Features:**');
            release.features.forEach(feature => {
                parts.push(`• ${feature}`);
            });
        }

        if (release.improvements && release.improvements.length > 0) {
            parts.push('\n**Improvements:**');
            release.improvements.forEach(improvement => {
                parts.push(`• ${improvement}`);
            });
        }

        if (release.bugfixes && release.bugfixes.length > 0) {
            parts.push('\n**Bug Fixes:**');
            release.bugfixes.forEach(fix => {
                parts.push(`• ${fix}`);
            });
        }

        let description = parts.join('\n');

        if (description.length > 4096) {
            description = description.substring(0, 4093) + '...';
        }

        return description || 'No release notes provided.';
    }
}


