import {
    Channel,
    CommandInteractionOptionResolver,
    Guild,
    PartialDMChannel,
    User,
} from 'discord.js';

import { Language } from '../models/enum-helpers/language.js';
import { EventData } from '../models/internal-models.js';

export class EventDataService {
    public async create(
        options: {
            user?: User;
            channel?: Channel | PartialDMChannel;
            guild?: Guild;
            args?: Omit<CommandInteractionOptionResolver, 'getMessage' | 'getFocused'>;
        } = {}
    ): Promise<EventData> {
        // Event language
        let lang =
            options.guild?.preferredLocale &&
            Language.Enabled.includes(options.guild.preferredLocale)
                ? options.guild.preferredLocale
                : Language.Default;

        // Guild language
        let langGuild =
            options.guild?.preferredLocale &&
            Language.Enabled.includes(options.guild.preferredLocale)
                ? options.guild.preferredLocale
                : Language.Default;
                
        // Get user permissions if available
        let userPermissions: string[] | undefined = undefined;
        if (options.guild && options.user) {
            try {
                const member = await options.guild.members.fetch(options.user.id);
                userPermissions = member.permissions.toArray();
            } catch (error) {
                console.warn(`Could not fetch member permissions: ${error}`);
            }
        }
        
        // Create context object with additional useful data
        const context: Record<string, any> = {};
        if (options.channel?.id) {
            context.channelId = options.channel.id;
        }
        if (options.guild?.id) {
            context.guildId = options.guild.id;
        }
        if (options.user?.id) {
            context.userId = options.user.id;
        }

        return new EventData(lang, langGuild, userPermissions, context);
    }
}
