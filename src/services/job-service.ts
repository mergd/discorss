import parser from 'cron-parser';
import { DateTime } from 'luxon';
import schedule, { Job as ScheduledJob } from 'node-schedule';
import { createRequire } from 'node:module';

import { Logger } from './index.js';
import { Job } from '../jobs/index.js';

const require = createRequire(import.meta.url);
let Logs = require('../../lang/logs.json');

export class JobService {
    private scheduledJobs: ScheduledJob[] = [];

    constructor(private jobs: Job[]) {}

    public start(): void {
        for (let job of this.jobs) {
            let jobSchedule = job.runOnce
                ? parser
                      .parseExpression(job.schedule, {
                          currentDate: DateTime.now()
                              .plus({ seconds: job.initialDelaySecs })
                              .toJSDate(),
                      })
                      .next()
                      .toDate()
                : {
                      start: DateTime.now().plus({ seconds: job.initialDelaySecs }).toJSDate(),
                      rule: job.schedule,
                  };

            const scheduledJob = schedule.scheduleJob(jobSchedule, async () => {
                try {
                    if (job.log) {
                        Logger.info(Logs.info.jobRun.replaceAll('{JOB}', job.name));
                    }

                    await job.run();

                    if (job.log) {
                        Logger.info(Logs.info.jobCompleted.replaceAll('{JOB}', job.name));
                    }
                } catch (error) {
                    Logger.error(Logs.error.job.replaceAll('{JOB}', job.name), error);
                }
            });

            if (scheduledJob) {
                this.scheduledJobs.push(scheduledJob);
            }

            Logger.info(
                Logs.info.jobScheduled
                    .replaceAll('{JOB}', job.name)
                    .replaceAll('{SCHEDULE}', job.schedule)
            );
        }
    }

    public async stop(): Promise<void> {
        Logger.info('[JobService] Stopping all scheduled jobs...');
        
        for (const scheduledJob of this.scheduledJobs) {
            scheduledJob.cancel();
        }
        
        this.scheduledJobs = [];
        
        for (const job of this.jobs) {
            if (typeof (job as any).stop === 'function') {
                try {
                    await (job as any).stop();
                } catch (error) {
                    Logger.error(`[JobService] Error stopping job ${job.name}:`, error);
                }
            }
        }
        
        Logger.info('[JobService] All scheduled jobs stopped.');
    }
}
