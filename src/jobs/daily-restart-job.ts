import { Job } from './job.js';
import { Logger } from '../services/index.js';

export class DailyRestartJob implements Job {
    public name = 'Periodic Restart';
    public schedule: string = '0 */12 * * *'; // Every 12 hours
    public log: boolean = true;
    public runOnce = false;
    public initialDelaySecs = 0;

    private startTime: number;

    constructor() {
        this.startTime = Date.now();
    }

    public async run(): Promise<void> {
        const uptimeHours = (Date.now() - this.startTime) / (1000 * 60 * 60);

        Logger.info(
            `[DailyRestartJob] Triggering daily restart. Uptime: ${uptimeHours.toFixed(2)} hours`
        );
        Logger.info('[DailyRestartJob] Initiating graceful shutdown for memory reset...');

        // Trigger graceful shutdown - Railway will automatically restart the service
        process.kill(process.pid, 'SIGTERM');
    }
}
