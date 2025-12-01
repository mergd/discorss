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
        this.setupHealthcheck();
        this.setupControllers();
        this.app.use(handleError());
    }

    private setupHealthcheck(): void {
        // Health endpoint for Railway healthchecks
        // Returns unhealthy (503) if memory usage exceeds threshold
        this.app.get('/health', (_req, res) => {
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            const rssMB = Math.round(memUsage.rss / 1024 / 1024);
            
            const MEMORY_THRESHOLD_MB = 350; // Return unhealthy above this - more aggressive to prevent OOM
            const isHealthy = rssMB < MEMORY_THRESHOLD_MB;
            
            const status = {
                status: isHealthy ? 'healthy' : 'unhealthy',
                memory: {
                    rss: `${rssMB}MB`,
                    heap: `${heapUsedMB}MB`,
                    threshold: `${MEMORY_THRESHOLD_MB}MB`,
                },
                uptime: Math.round(process.uptime()),
            };
            
            res.status(isHealthy ? 200 : 503).json(status);
        });
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
