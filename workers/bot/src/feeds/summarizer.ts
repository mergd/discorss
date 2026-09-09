import { Analytics } from '../analytics.js';
import { FALLBACK_MODEL_NAME, MODEL_NAME } from '../constants.js';
import type { Env } from '../env.js';
import { notifyModelCreditsExhausted } from '../model-credit-alert.js';
import { calculateReadTime } from '../utils.js';

const INITIAL_HTML_BYTES = 50_000;
const MAX_HTML_BYTES = 500_000;
const MAX_EXTRACTED_CONTENT_LENGTH = 8_000;

export function hasSubstantialFeedContent(content: string | null | undefined): content is string {
    if (!content) return false;

    const plainText = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/&[a-zA-Z0-9#]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return plainText.length > 200;
}

function hasCompleteReadableContainer(html: string): boolean {
    return (
        /<article\b[^>]*>[\s\S]{500,}<\/article>/i.test(html) ||
        /<main\b[^>]*>[\s\S]{500,}<\/main>/i.test(html)
    );
}

function cleanHtmlFragment(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-zA-Z0-9#]+;/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(https?:\/\/[^\s\)]+\)/g, ' ')
        .replace(/https?:\/\/[^\s]+/g, ' ')
        .replace(/[^\w\s.,!?;:'"()-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractMetaDescription(html: string): string | null {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        const key = tag.match(/\b(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
        if (key !== 'description' && key !== 'og:description' && key !== 'twitter:description') {
            continue;
        }

        const description = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
        if (!description) continue;
        const cleaned = cleanHtmlFragment(description);
        if (cleaned.length >= 80) return cleaned;
    }

    return null;
}

/**
 * Fetches a page's HTML (bounded) and extracts readable text with the same
 * regex approach the Node bot used.
 */
async function fetchPageContentOnce(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'DiscorssBot/1.0 (Feed Summarization)',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
            console.warn(`[Summarizer] Page fetch failed with ${res.status}: ${url}`);
            await res.body?.cancel();
            return null;
        }

        const contentType = res.headers.get('content-type');
        if (
            contentType &&
            !contentType.includes('text/html') &&
            !contentType.includes('application/xhtml+xml')
        ) {
            await res.body?.cancel();
            return null;
        }

        // Many publisher pages put more than 50 KB of styles and metadata before
        // the article. Keep streaming until a readable container is complete,
        // while retaining a hard ceiling for unusually large responses.
        let html = '';
        if (res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let totalBytes = 0;
            while (totalBytes < MAX_HTML_BYTES) {
                const { done, value } = await reader.read();
                if (done) break;

                const remainingBytes = MAX_HTML_BYTES - totalBytes;
                const chunk =
                    value.byteLength > remainingBytes ? value.slice(0, remainingBytes) : value;
                totalBytes += chunk.byteLength;
                html += decoder.decode(chunk, { stream: true });

                if (totalBytes >= INITIAL_HTML_BYTES && hasCompleteReadableContainer(html)) {
                    break;
                }
            }
            html += decoder.decode();
            await reader.cancel().catch(() => undefined);
        }

        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        let textContent = bodyMatch ? bodyMatch[1] : html;

        textContent = textContent
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ');

        const contentPatterns = [
            /<main[^>]*>([\s\S]*?)<\/main>/gi,
            /<article[^>]*>([\s\S]*?)<\/article>/gi,
            /role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
            /class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
            /id=["']content["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
        ];

        let extractedContent = '';
        for (const pattern of contentPatterns) {
            for (const match of textContent.matchAll(pattern)) {
                if (!match[1] || match[1].length <= 500) continue;
                const candidate = cleanHtmlFragment(match[1]);
                if (candidate.length > extractedContent.length) {
                    extractedContent = candidate;
                }
            }
        }

        const cleanedText =
            extractedContent.length >= 1_000 ? extractedContent : cleanHtmlFragment(textContent);

        const result = cleanedText || extractMetaDescription(html);
        return result ? result.substring(0, MAX_EXTRACTED_CONTENT_LENGTH) : null;
    } catch (error) {
        console.error(`[Summarizer] Error fetching page content from ${url}:`, error);
        return null;
    }
}

export async function fetchPageContent(url: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const content = await fetchPageContentOnce(url);
        if (content) return content;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
    }

    return null;
}

function isLowQualitySummary(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 25) return true;
    if (/^user safety:\s*safe\b/i.test(trimmed)) return true;
    if (/^thinking process\s*:/i.test(trimmed)) return true;
    if (/article summary\s*\(~?\d+\s*min read\):/i.test(trimmed) && trimmed.length < 100) {
        return true;
    }
    return false;
}

interface ChatCompletionResponse {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function callModel(
    env: Env,
    modelName: string,
    prompt: string
): Promise<
    { ok: true; text: string } | { ok: false; retryable: boolean; error: string; status?: number }
> {
    const apiKey = env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) {
        return { ok: false, retryable: false, error: 'No summarization API key configured' };
    }
    const useOpenRouter = !!env.OPENROUTER_API_KEY;
    const baseUrl = useOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(useOpenRouter
                ? {
                      'HTTP-Referer': 'https://github.com/mergd/discorss',
                      'X-Title': 'Discorss Bot',
                  }
                : {}),
        },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            ...(useOpenRouter
                ? { max_tokens: 4000, reasoning: { enabled: false } }
                : { max_completion_tokens: 4000 }),
        }),
        signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
            ok: false,
            retryable: res.status === 404 || res.status === 429 || res.status >= 500,
            error: `Model API error ${res.status}: ${text.substring(0, 200)}`,
            status: res.status,
        };
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content || '';
    if (!data.choices?.length) {
        return { ok: false, retryable: true, error: 'No choices in response' };
    }
    return { ok: true, text };
}

async function summarizeSingleContent(
    env: Env,
    analytics: Analytics,
    content: string,
    contentType: 'ARTICLE CONTENT' | 'COMMENTS CONTENT',
    sourceUrl?: string,
    language?: string | null,
    guildId?: string | null
): Promise<string | null> {
    if (!content) {
        return 'Could not generate summary: No content available.';
    }

    const maxInputLength = 10000;
    const truncatedContent =
        content.length > maxInputLength
            ? content.substring(0, maxInputLength) + '\n[Content Truncated]'
            : content;

    const languageInstruction = language
        ? `8. **IMPORTANT: Write the summary entirely in ${language} language. Use the language code "${language}" to determine the target language (e.g., "en" = English, "es" = Spanish, "fr" = French, "de" = German, etc.).**`
        : '';

    const prompt = `
You are an expert summarizer for Discord bot messages. Your task is to create a concise, neutral, and informative summary of the provided text.

**Instructions:**
1.  Analyze the provided ${contentType}.
2.  Write 1-2 short sentences (max 400 characters) covering only the main point.
3.  Use proper punctuation. End each sentence with a period. Do not write one run-on paragraph or comma-splice several ideas together.
4.  Focus on factual information presented. Avoid speculation or adding external knowledge.
5.  **Do NOT include any introductory phrases like "Here is a summary:", "This article discusses:", etc.** Just provide the summary text directly.
6.  **If you cannot determine meaningful content to summarize (e.g., the text is boilerplate, error messages, or nonsensical), respond ONLY with the exact phrase: "Could not generate summary: Insufficient content."**
7.  **If the content appears to primarily be metadata or links (like the description field from an RSS feed often is), DO NOT summarize that metadata.** Use the phrase from instruction 6.
8.  **IMPORTANT: Generate the summary directly without internal reasoning or thinking. Provide only the final summary text.**
${languageInstruction ? languageInstruction.replace(/^8\./, '9.') + '\n' : ''}
**Content to Summarize:**
${truncatedContent}

**Summary:**
    `;

    const distinctId = guildId || 'system_summarizer';
    const modelsToTry = [MODEL_NAME, FALLBACK_MODEL_NAME];
    const captureFailure = (
        reason: string,
        model: string,
        isFallback: boolean,
        extraProperties: Record<string, unknown> = {}
    ) =>
        analytics.capture({
            distinctId,
            event: 'summarization_failed',
            properties: {
                reason,
                model,
                isFallback,
                sourceUrl,
                contentType,
                contentLength: truncatedContent.length,
                ...extraProperties,
            },
            groups: guildId ? { guild: guildId } : undefined,
        });

    for (let i = 0; i < modelsToTry.length; i++) {
        const modelName = modelsToTry[i];
        const isFallback = i > 0;

        let result: Awaited<ReturnType<typeof callModel>>;
        try {
            result = await callModel(env, modelName, prompt);
        } catch (error) {
            console.error(`[Summarizer] Error calling ${modelName}:`, error);
            await analytics.captureException(distinctId, 'SummarizationModelError', error, {
                model: modelName,
                isFallback,
                sourceUrl,
                contentType,
            });
            if (i < modelsToTry.length - 1) continue;
            await captureFailure('model_exception', modelName, isFallback, {
                error: error instanceof Error ? error.message : String(error),
            });
            return 'Could not generate summary: Error contacting summarization service.';
        }

        if (!result.ok) {
            console.error(`[Summarizer] ${modelName} failed: ${result.error}`);
            await analytics.capture({
                distinctId,
                event: 'summarization_model_failure',
                properties: {
                    model: modelName,
                    isFallback,
                    sourceUrl,
                    contentType,
                    status: result.status,
                    error: result.error,
                },
            });
            if (result.status === 402) {
                await notifyModelCreditsExhausted(env);
            }
            if (result.retryable && i < modelsToTry.length - 1) continue;
            await captureFailure('model_failure', modelName, isFallback, {
                status: result.status,
                error: result.error,
            });
            return 'Could not generate summary: No response from model.';
        }

        const text = result.text;
        if (!text || text.trim().length === 0) {
            if (i < modelsToTry.length - 1) continue;
            await captureFailure('empty_response', modelName, isFallback);
            return 'Could not generate summary: Empty response from model.';
        }

        if (
            text.includes('Could not generate summary: Insufficient content.') &&
            i < modelsToTry.length - 1
        ) {
            await analytics.capture({
                distinctId,
                event: 'summarization_insufficient_content',
                properties: { model: modelName, isFallback, sourceUrl, contentType },
            });
            continue;
        }

        if (text.includes('Could not generate summary:')) {
            await captureFailure(
                text.includes('Insufficient content') ? 'insufficient_content' : 'model_rejection',
                modelName,
                isFallback,
                { response: text.substring(0, 200) }
            );
            return text;
        }

        if (isLowQualitySummary(text)) {
            await analytics.capture({
                distinctId,
                event: 'summarization_low_quality',
                properties: { model: modelName, isFallback, sourceUrl, contentType },
            });
            if (i < modelsToTry.length - 1) continue;
            await captureFailure('low_quality', modelName, isFallback);
            return 'Could not generate summary: Insufficient content.';
        }

        await analytics.capture({
            distinctId,
            event: 'summarization_success',
            properties: {
                model: modelName,
                isFallback,
                sourceUrl,
                contentType,
                contentLength: truncatedContent.length,
                summaryLength: text.length,
            },
            groups: guildId ? { guild: guildId } : undefined,
        });

        return text.trim();
    }

    return 'Could not generate summary: Error contacting summarization service.';
}

export async function summarizeContent(
    env: Env,
    analytics: Analytics,
    articleContent: string | null,
    commentsContent: string | null,
    sourceUrl?: string,
    language?: string | null,
    guildId?: string | null
): Promise<{
    articleSummary: string | null;
    commentsSummary: string | null;
    articleReadTime: number | null;
}> {
    let articleSummary: string | null = null;
    let commentsSummary: string | null = null;
    let articleReadTime: number | null = null;

    if (articleContent) {
        articleSummary = await summarizeSingleContent(
            env,
            analytics,
            articleContent,
            'ARTICLE CONTENT',
            sourceUrl,
            language,
            guildId
        );
        articleReadTime = calculateReadTime(articleContent);
    }
    if (commentsContent) {
        commentsSummary = await summarizeSingleContent(
            env,
            analytics,
            commentsContent,
            'COMMENTS CONTENT',
            sourceUrl,
            language,
            guildId
        );
    }
    return { articleSummary, commentsSummary, articleReadTime };
}
