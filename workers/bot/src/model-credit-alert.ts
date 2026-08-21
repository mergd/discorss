import type { Env } from './env.js';

const ALERT_KEY = 'model-credits-exhausted';
const ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const MODEL_CREDIT_ALERT_MESSAGE =
    '🚨 **Discorss summarization paused**\n' +
    'The model API rejected summary requests because the configured key has no credits remaining. Add credits or raise the key limit. Discorss will keep polling feeds and retry summaries automatically.\n\n' +
    '*This alert is limited to once every 24 hours.*';

async function claimAlert(env: Env, now: number): Promise<boolean> {
    const cutoff = now - ALERT_INTERVAL_MS;
    const result = await env.DB.prepare(
        `INSERT INTO system_notifications (notification_key, last_sent_at)
         VALUES (?, ?)
         ON CONFLICT(notification_key) DO UPDATE SET last_sent_at = excluded.last_sent_at
         WHERE system_notifications.last_sent_at <= ?
         RETURNING notification_key`
    )
        .bind(ALERT_KEY, now, cutoff)
        .first<{ notification_key: string }>();
    return result !== null;
}

async function releaseAlert(env: Env, now: number): Promise<void> {
    await env.DB.prepare(
        'DELETE FROM system_notifications WHERE notification_key = ? AND last_sent_at = ?'
    )
        .bind(ALERT_KEY, now)
        .run();
}

export async function notifyModelCreditsExhausted(env: Env): Promise<void> {
    if (!env.FEEDBACK_WEBHOOK_URL) {
        console.error('[Summarizer] Model credits exhausted, but FEEDBACK_WEBHOOK_URL is not set');
        return;
    }

    const now = Date.now();
    try {
        if (!(await claimAlert(env, now))) return;

        const response = await fetch(env.FEEDBACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: MODEL_CREDIT_ALERT_MESSAGE }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            await response.body?.cancel();
            await releaseAlert(env, now);
            console.error(
                `[Summarizer] Credit alert webhook failed with status ${response.status}`
            );
        }
    } catch (error) {
        await releaseAlert(env, now).catch(() => undefined);
        console.error('[Summarizer] Failed to send model credit alert:', error);
    }
}
