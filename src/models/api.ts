import express, { Express } from 'express';
import { createRequire } from 'node:module';
import util from 'node:util';

import { Controller } from '../controllers/index.js';
import { checkAuth, handleError } from '../middleware/index.js';
import { Logger } from '../services/index.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');
let Logs = require('../../lang/logs.json');

export class Api {
    private app: Express;
    private server: any = null;

    constructor(public controllers: Controller[]) {
        this.app = express();
        this.app.use(express.json());
        this.setupControllers();
        this.app.use(handleError());
    }

    public async start(): Promise<void> {
        let listen = util.promisify(this.app.listen.bind(this.app));
        this.server = await listen(Config.api.port);
        Logger.info(Logs.info.apiStarted.replaceAll('{PORT}', Config.api.port));
    }

    public async stop(): Promise<void> {
        Logger.info('[Api] Stopping API server...');
        if (this.server) {
            return new Promise<void>((resolve, reject) => {
                this.server.close((err?: Error) => {
                    if (err) {
                        Logger.error('[Api] Error stopping API server:', err);
                        reject(err);
                    } else {
                        Logger.info('[Api] API server stopped.');
                        resolve();
                    }
                });
            });
        }
    }

    private setupControllers(): void {
        for (let controller of this.controllers) {
            if (controller.authToken) {
                controller.router.use(checkAuth(controller.authToken));
            }
            controller.register();
            this.app.use(controller.path, controller.router);
        }
    }
}
