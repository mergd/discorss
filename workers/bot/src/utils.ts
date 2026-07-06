export function truncate(input: unknown, length: number, addEllipsis = false): string {
    if (input === null || input === undefined) return '';
    const str = String(input);
    if (str.length <= length) {
        return str;
    }
    let output = str.substring(0, addEllipsis ? length - 3 : length);
    if (addEllipsis) {
        output += '...';
    }
    return output;
}

export function getShortId(uuid: string): string {
    return uuid.substring(0, 8);
}

export function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

export function detectAndConvertTwitterUrl(url: string): {
    isTwitter: boolean;
    convertedUrl?: string;
    username?: string;
} {
    const twitterPattern = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/?$/;
    const match = url.match(twitterPattern);

    if (match) {
        const username = match[3];
        return {
            isTwitter: true,
            convertedUrl: `https://nitter.net/${username}/rss`,
            username,
        };
    }

    return { isTwitter: false };
}

// Allows: 2-char codes (en, es), language-region codes (en-US), or 3-char codes (eng)
export function validateLanguageCode(language: string | null): string | null {
    if (!language) return null;
    const trimmed = language.trim().toLowerCase();
    if (!trimmed) return null;
    const languageRegex = /^[a-z0-9]{2,10}(-[a-z0-9]{2,5})?$/;
    if (!languageRegex.test(trimmed)) {
        return null;
    }
    return trimmed;
}

export function isYouTubeFeed(feed: { url?: string | null; category?: string | null }): boolean {
    if (feed.url?.includes('youtube.com/feeds/videos.xml')) {
        return true;
    }
    const category = feed.category?.toLowerCase();
    return category === 'youtube' || category === 'yt';
}

export function isYouTubeShortLink(link?: string | null): boolean {
    if (!link) return false;
    return /youtube\.com\/shorts\//i.test(link);
}

/** null in DB means "default" — enabled for YouTube feeds, disabled otherwise */
export function shouldSkipYouTubeShorts(feed: {
    skipYoutubeShorts?: boolean | null;
    url?: string | null;
    category?: string | null;
}): boolean {
    if (feed.skipYoutubeShorts != null) return feed.skipYoutubeShorts;
    return isYouTubeFeed(feed);
}

const WORDS_PER_MINUTE = 225;
const MIN_READ_TIME = 1;

export function calculateReadTime(text: string): number {
    if (!text || text.trim().length === 0) {
        return MIN_READ_TIME;
    }
    const wordCount = text
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0).length;
    return Math.max(Math.ceil(wordCount / WORDS_PER_MINUTE), MIN_READ_TIME);
}
