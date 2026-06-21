import { Logger } from '../services/logger.js';
import { env } from './env.js';

const RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; DiscorssBot/1.0)',
    Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
};

const PROXY_TRIGGER_STATUSES = new Set([403, 429, 502, 503, 504]);
const DIRECT_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('socket hang up') ||
        message.includes('network') ||
        message.includes('fetch failed')
    );
}

async function readResponseText(res: Response): Promise<string> {
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Status code ${res.status}`);
    }
    return text;
}

async function fetchDirect(feedUrl: string): Promise<string> {
    const res = await fetch(feedUrl, {
        headers: RSS_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return readResponseText(res);
}

async function fetchViaProxy(feedUrl: string): Promise<string> {
    if (!env.FETCH_PROXY_URL || !env.FETCH_PROXY_SECRET) {
        throw new Error('RSS fetch proxy is not configured');
    }

    const proxyUrl = new URL(env.FETCH_PROXY_URL);
    proxyUrl.searchParams.set('url', feedUrl);

    Logger.info(`[RssFetch] Retrying via proxy: ${feedUrl}`);

    const res = await fetch(proxyUrl.toString(), {
        headers: {
            Authorization: `Bearer ${env.FETCH_PROXY_SECRET}`,
            Accept: RSS_HEADERS.Accept,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const text = await readResponseText(res);
    Logger.info(`[RssFetch] Proxy fetch succeeded for ${feedUrl}`);
    return text;
}

function shouldTryProxy(error: unknown, statusCode?: number): boolean {
    if (!env.FETCH_PROXY_URL || !env.FETCH_PROXY_SECRET) {
        return false;
    }
    if (statusCode !== undefined && PROXY_TRIGGER_STATUSES.has(statusCode)) {
        return true;
    }
    return isRetryableNetworkError(error);
}

function extractStatusCode(error: unknown): number | undefined {
    if (!(error instanceof Error)) return undefined;
    const match = error.message.match(/status code (\d{3})/i);
    return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * Fetches RSS/Atom XML with direct retries, then optional Cloudflare Worker fallback.
 */
export async function fetchRssXml(feedUrl: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < DIRECT_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            await sleep(RETRY_DELAY_MS);
        }

        try {
            return await fetchDirect(feedUrl);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const statusCode = extractStatusCode(error);

            if (shouldTryProxy(error, statusCode)) {
                try {
                    return await fetchViaProxy(feedUrl);
                } catch (proxyError) {
                    lastError =
                        proxyError instanceof Error ? proxyError : new Error(String(proxyError));
                }
                break;
            }

            if (attempt < DIRECT_ATTEMPTS - 1 && isRetryableNetworkError(error)) {
                continue;
            }

            break;
        }
    }

    if (shouldTryProxy(lastError, extractStatusCode(lastError))) {
        try {
            return await fetchViaProxy(feedUrl);
        } catch (proxyError) {
            lastError = proxyError instanceof Error ? proxyError : new Error(String(proxyError));
        }
    }

    throw lastError ?? new Error(`Failed to fetch RSS feed: ${feedUrl}`);
}
