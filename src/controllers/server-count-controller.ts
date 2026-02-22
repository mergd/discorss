import { Client } from 'discord.js';
import { Request, Response, Router } from 'express';
import router from 'express-promise-router';
import { createRequire } from 'node:module';

import { Controller } from './index.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

interface GetServerCountResponse {
    guilds: number;
}

export class ServerCountController implements Controller {
    public path = '/server-count';
    public router: Router = router();
    public authToken: string = Config.api.secret;

    constructor(private client: Client) {}

    public register(): void {
        this.router.get('/', (req, res) => this.getServerCount(req, res));
    }

    private async getServerCount(_req: Request, res: Response): Promise<void> {
        const resBody: GetServerCountResponse = {
            guilds: this.client.guilds.cache.size,
        };
        res.status(200).json(resBody);
    }
}
