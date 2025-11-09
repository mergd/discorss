import Parser from 'rss-parser';

// Shared RSS parser instance to reduce memory footprint
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
            // Allow feeds with empty titles or other minor issues
            maxRedirects: 5,
            timeout: 60000,
        });
    }
    return sharedParser;
}

export function resetRSSParser(): void {
    sharedParser = null;
}
