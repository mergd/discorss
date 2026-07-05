import { extractYouTubeVideoId } from './feed-utils.js';

const YOUTUBE_WATCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; DiscorssBot/1.0)',
    Range: 'bytes=0-49999',
};

const LIVE_HTML_PATTERNS = [/"isLive":\s*true/, /"isLiveNow":\s*true/];

export function isYouTubeLiveFromHtml(html: string): boolean {
    return LIVE_HTML_PATTERNS.some(pattern => pattern.test(html));
}

export async function isYouTubeLiveVideo(link?: string | null): Promise<boolean> {
    const videoId = extractYouTubeVideoId(link);
    if (!videoId) return false;

    try {
        const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: YOUTUBE_WATCH_HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) return false;

        const html = await res.text();
        return isYouTubeLiveFromHtml(html);
    } catch {
        return false;
    }
}
