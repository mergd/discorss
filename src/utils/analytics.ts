import { PostHog } from 'posthog-node';
import { env } from './env.js';

// Initialize PostHog if API key is provided
export const posthog = env.POSTHOG_API_KEY
    ? new PostHog(env.POSTHOG_API_KEY, {
          host: 'https://app.posthog.com',
          flushAt: 20,
          flushInterval: 10000,
      })
    : null;

// Export shutdown function for graceful cleanup
// DO NOT add process.on handlers here - they conflict with the main shutdown handlers
export async function shutdownPostHog(): Promise<void> {
    if (posthog) {
        await posthog.shutdown();
    }
}
