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
