import type { Env } from './env.js';

/**
 * Minimal fetch-based PostHog capture. posthog-node buffers with timers, which
 * Workers cannot keep across requests, so events are posted directly. Callers
 * should pass ctx.waitUntil-compatible usage (fire-and-forget is fine).
 */
export class Analytics {
    constructor(private apiKey: string | undefined) {}

    static fromEnv(env: Env): Analytics {
        return new Analytics(env.POSTHOG_API_KEY);
    }

    capture(event: {
        distinctId: string;
        event: string;
        properties?: Record<string, unknown>;
        groups?: Record<string, string>;
    }): Promise<void> {
        if (!this.apiKey) return Promise.resolve();
        return fetch('https://app.posthog.com/capture/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: this.apiKey,
                event: event.event,
                distinct_id: event.distinctId,
                properties: {
                    ...event.properties,
                    ...(event.groups ? { $groups: event.groups } : {}),
                },
                timestamp: new Date().toISOString(),
            }),
        })
            .then(() => undefined)
            .catch(() => undefined);
    }

    captureException(
        distinctId: string,
        type: string,
        error: unknown,
        properties?: Record<string, unknown>,
        groups?: Record<string, string>
    ): Promise<void> {
        return this.capture({
            distinctId,
            event: '$exception',
            properties: {
                $exception_type: type,
                $exception_message: error instanceof Error ? error.message : String(error),
                $exception_stack_trace: error instanceof Error ? error.stack : undefined,
                ...properties,
            },
            groups,
        });
    }
}
