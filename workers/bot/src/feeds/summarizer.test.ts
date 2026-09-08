import { afterEach, describe, expect, mock, test } from 'bun:test';

import { Analytics } from '../analytics.js';
import type { Env } from '../env.js';
import { fetchPageContent, summarizeContent } from './summarizer.js';

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
});

describe('summarizeContent', () => {
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
});
