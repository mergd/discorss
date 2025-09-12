import { FeedPollJob } from '../jobs/feed-poll-job.js';

/**
 * Global registry for job instances to allow access from commands and other services
 */
class JobRegistry {
    private static instance: JobRegistry;
    private feedPollJob: FeedPollJob | null = null;

    private constructor() {}

    public static getInstance(): JobRegistry {
        if (!JobRegistry.instance) {
            JobRegistry.instance = new JobRegistry();
        }
        return JobRegistry.instance;
    }

    public setFeedPollJob(job: FeedPollJob): void {
        this.feedPollJob = job;
    }

    public getFeedPollJob(): FeedPollJob | null {
        return this.feedPollJob;
    }
}

export { JobRegistry };
