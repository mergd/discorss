import { describe, expect, it } from 'vitest';
import {
    isYouTubeFeed,
    isYouTubeShortLink,
    shouldSkipYouTubeShorts,
} from '../../src/utils/feed-utils.js';

describe('feed-utils', () => {
    describe('isYouTubeShortLink', () => {
        it('detects YouTube shorts URLs', () => {
            expect(
                isYouTubeShortLink('https://www.youtube.com/shorts/abc123')
            ).toBe(true);
            expect(isYouTubeShortLink('https://youtube.com/shorts/xyz')).toBe(true);
        });

        it('ignores regular YouTube watch URLs', () => {
            expect(
                isYouTubeShortLink('https://www.youtube.com/watch?v=abc123')
            ).toBe(false);
        });
    });

    describe('shouldSkipYouTubeShorts', () => {
        it('defaults to true for YouTube feeds when unset', () => {
            expect(
                shouldSkipYouTubeShorts({
                    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123',
                })
            ).toBe(true);
        });

        it('defaults to false for non-YouTube feeds when unset', () => {
            expect(shouldSkipYouTubeShorts({ url: 'https://example.com/rss.xml' })).toBe(
                false
            );
        });

        it('respects explicit override', () => {
            expect(
                shouldSkipYouTubeShorts({
                    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123',
                    skipYoutubeShorts: false,
                })
            ).toBe(false);
        });
    });

    describe('isYouTubeFeed', () => {
        it('matches feed URL and category', () => {
            expect(
                isYouTubeFeed({
                    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123',
                })
            ).toBe(true);
            expect(isYouTubeFeed({ url: 'https://example.com/rss', category: 'YouTube' })).toBe(
                true
            );
        });
    });
});
