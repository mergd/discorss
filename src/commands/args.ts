import { APIApplicationCommandBasicOption, ApplicationCommandOptionType } from 'discord.js';

import { DevCommandName, HelpOption, InfoOption } from '../enums/index.js';

export class Args {
    public static readonly DEV_COMMAND: APIApplicationCommandBasicOption = {
        name: 'command',
        description: 'The specific dev command to run',
        type: ApplicationCommandOptionType.String,
        choices: [
            {
                name: 'info',
                value: DevCommandName.INFO,
            },
        ],
    };
    public static readonly HELP_OPTION: APIApplicationCommandBasicOption = {
        name: 'option',
        description: 'Help topic to display',
        type: ApplicationCommandOptionType.String,
        choices: [
            {
                name: 'Contact Support',
                value: HelpOption.CONTACT_SUPPORT,
            },
            {
                name: 'Commands',
                value: HelpOption.COMMANDS,
            },
        ],
    };
    public static readonly INFO_OPTION: APIApplicationCommandBasicOption = {
        name: 'option',
        description: 'Info topic to display',
        type: ApplicationCommandOptionType.String,
        choices: [
            {
                name: 'About',
                value: InfoOption.ABOUT,
            },
        ],
    };
}
