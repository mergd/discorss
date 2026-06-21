import Parser from 'rss-parser';
import { fetchRssXml } from './rss-fetch.js';

let sharedParser: Parser<any, any> | null = null;

export function getRSSParser(): Parser<any, any> {
    if (!sharedParser) {
        sharedParser = new Parser({
            customFields: {
                item: [
                    'guid',
                    'isoDate',
                    'creator',
                    'author',
                    'content',
                    'contentSnippet',
                    'comments',
                ],
            },
            maxRedirects: 5,
            timeout: 60000,
        });
    }
    return sharedParser;
}

export function resetRSSParser(): void {
    sharedParser = null;
}

export async function parseFeedUrl(url: string): Promise<Parser.Output<any>> {
    const xml = await fetchRssXml(url);
    return getRSSParser().parseString(xml);
}
