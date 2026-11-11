import { afterEach, describe, expect, mock, test } from 'bun:test';

import { Analytics } from '../analytics.js';
import type { Env } from '../env.js';
import { fetchPageContent, hasSubstantialFeedContent, summarizeContent } from './summarizer.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('fetchPageContent', () => {
    test('continues past a large document head to extract the article', async () => {
        const articleText =
            'Healthy soil exposes people to a wider variety of beneficial microbes. '.repeat(12);
        const html = `<html><head><style>${'x'.repeat(60_000)}</style></head><body><main><article><p>${articleText}</p></article></main></body></html>`;

        globalThis.fetch = mock(
            async () =>
                new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        ) as unknown as typeof fetch;

        const content = await fetchPageContent('https://example.com/article');

        expect(content).toContain('Healthy soil exposes people');
        expect(content).not.toContain('xxxxxxxx');
    });

    test('keeps the response bounded when no readable container is found', async () => {
        const html = `<html><body>${'word '.repeat(150_000)}</body></html>`;

        globalThis.fetch = mock(
            async () => new Response(html, { headers: { 'content-type': 'text/html' } })
        ) as unknown as typeof fetch;

        const content = await fetchPageContent('https://example.com/large-page');

        expect(content).not.toBeNull();
        expect(content!.length).toBeLessThanOrEqual(8_000);
    });

    test('chooses the most substantial article instead of the first article element', async () => {
        const navigation = `<article>${'<span></span>'.repeat(50)}Navigation</article>`;
        const story = `<article><p>${'The actual story contains useful reporting and concrete details. '.repeat(24)}</p></article>`;
        const html = `<html><body>${navigation}${story}</body></html>`;

        globalThis.fetch = mock(
            async () => new Response(html, { headers: { 'content-type': 'text/html' } })
        ) as unknown as typeof fetch;

        const content = await fetchPageContent('https://example.com/multiple-articles');

        expect(content).toContain('The actual story contains useful reporting');
        expect(content).not.toContain('Navigation');
    });

    test('uses a substantial social-card description when the page body is empty', async () => {
        const description =
            'This social post contains a complete argument with enough detail to summarize accurately.';
        const html = `<html><head><meta property="og:description" content="${description}"></head><body></body></html>`;

        globalThis.fetch = mock(
            async () => new Response(html, { headers: { 'content-type': 'text/html' } })
        ) as unknown as typeof fetch;

        const content = await fetchPageContent('https://example.social/post/123');

        expect(content).toBe(description);
    });

    test('retries an empty page response once', async () => {
        let attempts = 0;
        globalThis.fetch = mock(async () => {
            attempts++;
            const html =
                attempts === 1
                    ? '<html><body></body></html>'
                    : `<html><body><article>${'Recovered article content. '.repeat(50)}</article></body></html>`;
            return new Response(html, { headers: { 'content-type': 'text/html' } });
        }) as unknown as typeof fetch;

        const content = await fetchPageContent('https://example.com/transient-failure');

        expect(attempts).toBe(2);
        expect(content).toContain('Recovered article content');
    });
});

describe('hasSubstantialFeedContent', () => {
    test('rejects Hacker News RSS metadata even when its HTML exceeds 200 characters', () => {
        const content = `
            <p>Article URL: <a href="https://example.com/a-long-article">https://example.com/a-long-article</a></p>
            <p>Comments URL: <a href="https://news.ycombinator.com/item?id=123">https://news.ycombinator.com/item?id=123</a></p>
            <p>Points: 100</p>
            <p># Comments: 50</p>
        `;

        expect(content.length).toBeGreaterThan(200);
        expect(hasSubstantialFeedContent(content)).toBeFalse();
    });

    test('accepts substantial prose in a feed item', () => {
        const content = `<p>${'This paragraph contains meaningful article prose. '.repeat(8)}</p>`;

        expect(hasSubstantialFeedContent(content)).toBeTrue();
    });
});

describe('summarizeContent', () => {
    test('uses Haiku on the Anthropic provider without calling fallbacks on success', async () => {
        const requests: Array<Record<string, unknown>> = [];
        globalThis.fetch = mock(async (_input, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return Response.json({
                choices: [
                    { message: { content: 'The town approved longer library opening hours.' } },
                ],
            });
        }) as unknown as typeof fetch;

        const result = await summarizeContent(
            { OPENROUTER_API_KEY: 'test-key' } as Env,
            new Analytics(undefined),
            'The town council voted to keep the public library open longer on weekends.',
            null
        );

        expect(result.articleSummary).toBe('The town approved longer library opening hours.');
        expect(requests).toHaveLength(1);
        expect(requests[0].model).toBe('anthropic/claude-haiku-5.5');
        expect(requests[0].provider).toEqual({ only: ['anthropic'], allow_fallbacks: false });
    });

    test.each([401, 402, 403, 429, 503])(
        'tries both BYOK models before Qwen when providers return %s',
        async status => {
            const requests: Array<{ model: string; provider?: unknown }> = [];
            globalThis.fetch = mock(async (_input, init) => {
                requests.push(JSON.parse(String(init?.body)));
                if (requests.length <= 2) return new Response('Provider unavailable', { status });
                return Response.json({
                    choices: [
                        { message: { content: 'The town approved longer library opening hours.' } },
                    ],
                });
            }) as unknown as typeof fetch;

            const result = await summarizeContent(
                { OPENROUTER_API_KEY: 'test-key' } as Env,
                new Analytics(undefined),
                'The town council voted to keep the public library open longer on weekends.',
                null
            );

            expect(result.articleSummary).toBe('The town approved longer library opening hours.');
            expect(requests.map(request => request.model)).toEqual([
                'anthropic/claude-haiku-5.5',
                'openai/gpt-6-luna',
                'qwen/qwen3.5-flash-02-23',
            ]);
            expect(requests[1].provider).toEqual({ only: ['openai'], allow_fallbacks: false });
            expect(requests[2].provider).toBeUndefined();
        }
    );

    test('retains Ling as the final fallback after Qwen fails', async () => {
        const models: string[] = [];
        globalThis.fetch = mock(async (_input, init) => {
            models.push(JSON.parse(String(init?.body)).model);
            if (models.length < 4) return new Response('Rate limited', { status: 429 });
            return Response.json({
                choices: [
                    { message: { content: 'The town approved longer library opening hours.' } },
                ],
            });
        }) as unknown as typeof fetch;

        const result = await summarizeContent(
            { OPENROUTER_API_KEY: 'test-key' } as Env,
            new Analytics(undefined),
            'The town council voted to keep the public library open longer on weekends.',
            null
        );

        expect(models.at(-1)).toBe('inclusionai/ling-3.0-flash');
        expect(models).toHaveLength(4);
        expect(result.articleSummary).toBe('The town approved longer library opening hours.');
    });

    test('uses a native Luna model ID when only an OpenAI key is configured', async () => {
        let requestedUrl: unknown;
        let requestedBody: Record<string, unknown> = {};
        globalThis.fetch = mock(async (input, init) => {
            requestedUrl = input;
            requestedBody = JSON.parse(String(init?.body));
            return Response.json({
                choices: [
                    { message: { content: 'The town approved longer library opening hours.' } },
                ],
            });
        }) as unknown as typeof fetch;

        const result = await summarizeContent(
            { OPENAI_API_KEY: 'test-key' } as Env,
            new Analytics(undefined),
            'The town council voted to keep the public library open longer on weekends.',
            null
        );

        expect(result.articleSummary).toBe('The town approved longer library opening hours.');
        expect(requestedUrl).toBe('https://api.openai.com/v1/chat/completions');
        expect(requestedBody.model).toBe('gpt-6-luna');
        expect(requestedBody.provider).toBeUndefined();
        expect(requestedBody.max_completion_tokens).toBe(4000);
    });

    test('tries the fallback model after an insufficient-content response', async () => {
        const requestedModels: string[] = [];
        globalThis.fetch = mock(async (_input, init) => {
            const body = JSON.parse(String(init?.body)) as { model: string };
            requestedModels.push(body.model);
            const content =
                requestedModels.length === 1
                    ? 'Could not generate summary: Insufficient content.'
                    : 'Working in soil can increase exposure to beneficial microbes.';
            return Response.json({ choices: [{ message: { content } }] });
        }) as unknown as typeof fetch;

        const result = await summarizeContent(
            { OPENROUTER_API_KEY: 'test-key' } as Env,
            new Analytics(undefined),
            'A sufficiently detailed article about soil, microbes, and immune health.',
            null
        );

        expect(requestedModels).toHaveLength(2);
        expect(result.articleSummary).toBe(
            'Working in soil can increase exposure to beneficial microbes.'
        );
    });

    test('records a terminal failure when all models reject the content', async () => {
        globalThis.fetch = mock(async () =>
            Response.json({
                choices: [
                    {
                        message: {
                            content: 'Could not generate summary: Insufficient content.',
                        },
                    },
                ],
            })
        ) as unknown as typeof fetch;

        const analytics = new Analytics(undefined);
        const capturedEvents: Array<{ event: string; properties?: Record<string, unknown> }> = [];
        analytics.capture = mock(async event => {
            capturedEvents.push(event);
        });

        const result = await summarizeContent(
            { OPENROUTER_API_KEY: 'test-key' } as Env,
            analytics,
            'Content that all configured models decline to summarize.',
            null,
            'https://example.com/rejected'
        );

        expect(result.articleSummary).toBe('Could not generate summary: Insufficient content.');
        expect(capturedEvents.some(event => event.event === 'summarization_failed')).toBeTrue();
        expect(
            capturedEvents.find(event => event.event === 'summarization_failed')?.properties?.reason
        ).toBe('insufficient_content');
    });
});
