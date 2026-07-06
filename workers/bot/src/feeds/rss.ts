import Parser from 'rss-parser';

const RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; DiscorssBot/1.0)',
    Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
};

const DIRECT_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 30_000;

export interface ParsedFeedItem {
    title?: string;
    link?: string;
    pubDate?: string;
    isoDate?: string;
    guid?: string;
    creator?: string;
    author?: string;
    content?: string;
    contentSnippet?: string;
    'content:encoded'?: string;
    comments?: string;
    articleSummary?: string | null;
    commentsSummary?: string | null;
    articleReadTime?: number | null;
}

export interface ParsedFeed {
    title?: string;
    link?: string;
    description?: string;
    items: ParsedFeedItem[];
}

function isRetryableNetworkError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('network') ||
        message.includes('fetch failed') ||
        message.includes('aborted')
    );
}

async function fetchDirect(feedUrl: string): Promise<string> {
    const res = await fetch(feedUrl, {
        headers: RSS_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Status code ${res.status}`);
    }
    return text;
}

export async function fetchRssXml(feedUrl: string): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < DIRECT_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
        try {
            return await fetchDirect(feedUrl);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < DIRECT_ATTEMPTS - 1 && isRetryableNetworkError(error)) {
                continue;
            }
            break;
        }
    }
    throw lastError ?? new Error(`Failed to fetch RSS feed: ${feedUrl}`);
}

const parser = new Parser({
    customFields: {
        item: ['guid', 'isoDate', 'creator', 'author', 'content', 'contentSnippet', 'comments'],
    },
});

export async function parseFeedUrl(url: string): Promise<ParsedFeed> {
    const xml = await fetchRssXml(url);
    // parseString is pure XML parsing — no Node HTTP involved, safe on Workers.
    return (await parser.parseString(xml)) as unknown as ParsedFeed;
}
