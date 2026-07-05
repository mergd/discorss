export function isYouTubeFeed(feed: {
    url?: string | null;
    category?: string | null;
}): boolean {
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

export function extractYouTubeVideoId(link?: string | null): string | null {
    if (!link) return null;

    const watchMatch = link.match(
        /(?:youtube\.com\/watch\?(?:[^&]*&)*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (watchMatch) return watchMatch[1];

    const embedMatch = link.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    return embedMatch?.[1] ?? null;
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

/** null in DB means "default" — enabled for YouTube feeds, disabled otherwise */
export function shouldSkipYouTubeLivestreams(feed: {
    skipYoutubeLivestreams?: boolean | null;
    url?: string | null;
    category?: string | null;
}): boolean {
    if (feed.skipYoutubeLivestreams != null) return feed.skipYoutubeLivestreams;
    return isYouTubeFeed(feed);
}
