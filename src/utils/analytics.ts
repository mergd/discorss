import { PostHog } from 'posthog-node';
import { env } from './env.js';

// Initialize PostHog if API key is provided
export const posthog = env.POSTHOG_API_KEY
    ? new PostHog(env.POSTHOG_API_KEY, {
          host: 'https://app.posthog.com',
      })
    : null;

// Graceful shutdown for PostHog
if (posthog) {
    process.on('exit', () => {
        posthog.shutdown();
    });
    process.on('SIGINT', () => {
        posthog.shutdown();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        posthog.shutdown();
        process.exit(0);
    });
}
