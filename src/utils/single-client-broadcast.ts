import { Client } from 'discord.js';

type BroadcastEvalOptions<Context> = {
    context: Context;
};

export class SingleClientBroadcast {
    constructor(private client: Client) {}

    public async broadcastEval<Result, Context>(
        fn: (client: Client, context: Context) => Result | Promise<Result>,
        options: BroadcastEvalOptions<Context>
    ): Promise<Result[]> {
        const result = await fn(this.client, options.context);
        return [result];
    }
}
