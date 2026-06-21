export interface Env {
    FETCH_PROXY_SECRET: string;
}

const RSS_ACCEPT =
    'application/rss+xml, application/xml, text/xml, application/atom+xml, application/xhtml+xml, */*';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== 'GET') {
            return new Response('Method not allowed', { status: 405 });
        }

        const auth = request.headers.get('Authorization');
        if (!env.FETCH_PROXY_SECRET || auth !== `Bearer ${env.FETCH_PROXY_SECRET}`) {
            return new Response('Unauthorized', { status: 401 });
        }

        const target = new URL(request.url).searchParams.get('url');
        if (!target) {
            return new Response('Missing url query parameter', { status: 400 });
        }

        let feedUrl: URL;
        try {
            feedUrl = new URL(target);
        } catch {
            return new Response('Invalid url', { status: 400 });
        }

        if (feedUrl.protocol !== 'http:' && feedUrl.protocol !== 'https:') {
            return new Response('Only http(s) URLs are allowed', { status: 400 });
        }

        const upstream = await fetch(feedUrl.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; DiscorssBot/1.0)',
                Accept: RSS_ACCEPT,
            },
            redirect: 'follow',
        });

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: {
                'Content-Type': upstream.headers.get('Content-Type') ?? 'application/xml',
                'Cache-Control': 'no-store',
            },
        });
    },
};
