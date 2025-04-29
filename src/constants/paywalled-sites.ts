/**
 * A list of domain names known to often have paywalls.
 * This is used to provide an archive.is link as an alternative.
 * Keep the list in lowercase for case-insensitive matching.
 */
export const PAYWALLED_DOMAINS: Set<string> = new Set([
    'wsj.com',
    'nytimes.com',
    'ft.com', // Financial Times
    'thetimes.co.uk',
    'bloomberg.com',
    'theathletic.com',
    'hbr.org', // Harvard Business Review
    'economist.com',
    'washingtonpost.com',
    'medium.com', // Often paywalled based on user limits
    'technologyreview.com', // MIT Technology Review
    'newyorker.com',
    'theatlantic.com',
    'wired.com', // Sometimes
    'seekingalpha.com',
    'statista.com',
    // Add more domains as needed
]);

/**
 * Prepends the archive.is prefix to a URL.
 * @param url The original URL.
 * @returns The archive.is URL.
 */
export const getArchiveUrl = (url: string): string => {
    // Ensure no double slashes if url already starts with one
    const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
    // Ensure the URL starts with http:// or https:// for archive.is
    if (!/^https?:\/\//i.test(cleanUrl)) {
        // Attempt to prefix with https:// as a default
        return `https://archive.is/https://${cleanUrl}`;
    }
    return `https://archive.is/${cleanUrl}`;
};

/**
 * Checks if a URL's domain is in the known paywalled list.
 * @param url The URL to check.
 * @returns True if the domain is considered paywalled, false otherwise.
 */
export const isPaywalled = (url: string | undefined): boolean => {
    if (!url) return false; // Handle undefined input
    try {
        // Ensure the URL has a protocol for correct parsing
        let fullUrl = url;
        if (!/^https?:\/\//i.test(url)) {
            fullUrl = `https://${url}`; // Assume https if missing
        }
        const parsedUrl = new URL(fullUrl);
        const domain = parsedUrl.hostname.startsWith('www.')
            ? parsedUrl.hostname.substring(4)
            : parsedUrl.hostname;
        return PAYWALLED_DOMAINS.has(domain.toLowerCase());
    } catch (e) {
        // Invalid URL format, assume not paywalled for safety
        console.warn(`[PaywallCheck] Could not parse URL: ${url}`, e);
        return false;
    }
};
