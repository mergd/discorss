export const ITEMS_PER_PAGE = 7;
export const MAX_RECENT_LINKS = 30;
export const DEFAULT_FREQUENCY_MINUTES = 15;
export const MIN_FREQUENCY_MINUTES = 3;
export const MAX_FREQUENCY_MINUTES = 1440;
export const FAILURE_NOTIFICATION_THRESHOLD = 10;
export const FAILURE_QUIET_PERIOD_HOURS = 24;
export const MAX_ITEM_HOURS = 12;
export const BASE_MINUTES = 15;
export const MAX_MINUTES = 1440;
export const MODEL_NAME = 'google/gemini-2.5-flash-lite';
/** Specific free model — avoid openrouter/free router (unpredictable junk outputs) */
export const FALLBACK_MODEL_NAME = 'meta-llama/llama-3.3-70b-instruct:free';
export const CATEGORY_BACKOFF_COORDINATION_FACTOR = 0.5;
export const MAX_ITEMS_PER_FEED = 5;

/**
 * Domains known to often have paywalls; used to add archive.is links.
 * Keep lowercase.
 */
export const PAYWALLED_DOMAINS: Set<string> = new Set([
    'wsj.com',
    'nytimes.com',
    'ft.com',
    'thetimes.co.uk',
    'bloomberg.com',
    'theathletic.com',
    'hbr.org',
    'economist.com',
    'washingtonpost.com',
    'medium.com',
    'technologyreview.com',
    'newyorker.com',
    'theatlantic.com',
    'wired.com',
    'seekingalpha.com',
    'statista.com',
]);

export const getArchiveUrl = (url: string): string => {
    const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
    if (!/^https?:\/\//i.test(cleanUrl)) {
        return `https://archive.is/https://${cleanUrl}`;
    }
    return `https://archive.is/${cleanUrl}`;
};

export const isPaywalled = (url: string | undefined | null): boolean => {
    if (!url) return false;
    try {
        let fullUrl = url;
        if (!/^https?:\/\//i.test(url)) {
            fullUrl = `https://${url}`;
        }
        const parsedUrl = new URL(fullUrl);
        const domain = parsedUrl.hostname.startsWith('www.')
            ? parsedUrl.hostname.substring(4)
            : parsedUrl.hostname;
        return PAYWALLED_DOMAINS.has(domain.toLowerCase());
    } catch {
        return false;
    }
};
