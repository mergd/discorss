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
