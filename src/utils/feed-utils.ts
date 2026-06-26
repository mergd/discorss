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

/** null in DB means "default" — enabled for YouTube feeds, disabled otherwise */
export function shouldSkipYouTubeShorts(feed: {
    skipYoutubeShorts?: boolean | null;
    url?: string | null;
    category?: string | null;
}): boolean {
    if (feed.skipYoutubeShorts != null) return feed.skipYoutubeShorts;
    return isYouTubeFeed(feed);
}
