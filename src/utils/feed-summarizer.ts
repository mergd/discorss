import fetch from 'node-fetch';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { MODEL_NAME, FALLBACK_MODEL_NAME } from '../constants/misc.js';
import { Logger } from '../services/logger.js';
import { posthog } from './analytics.js';
import { getOpenAIClient } from '../services/openai-service.js';
import { calculateReadTime } from './read-time.js';
import { env } from './env.js';

const SUMMARY_LIMIT_PER_24H = 100;
const SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;
const guildSummaryUsage: Map<string, number[]> = new Map();

/**
 * Cleans up stale guild entries from the summary usage map.
 * Removes guilds that haven't made any summarization calls in the last 24 hours.
 * Call this periodically to prevent memory leaks.
 */
export function cleanupStaleSummaryUsage(): number {
    const now = Date.now();
    let removedCount = 0;

    for (const [guildId, timestamps] of guildSummaryUsage) {
        // Filter to only recent timestamps
        const recentTimestamps = timestamps.filter(ts => now - ts <= SUMMARY_WINDOW_MS);

        if (recentTimestamps.length === 0) {
            // No recent activity - remove the guild entirely
            guildSummaryUsage.delete(guildId);
            removedCount++;
        } else if (recentTimestamps.length !== timestamps.length) {
            // Update with cleaned timestamps
            guildSummaryUsage.set(guildId, recentTimestamps);
        }
    }

    return removedCount;
}

/**
 * Gets the current size of the guild summary usage map (for monitoring).
 */
export function getSummaryUsageMapSize(): number {
    return guildSummaryUsage.size;
}

type GuildSummaryConsumptionResult = {
    allowed: boolean;
    resetInMs?: number;
};

function formatResetDuration(resetInMs?: number): string {
    if (!resetInMs || resetInMs <= 0) return '24 hours';

    const hours = Math.floor(resetInMs / (60 * 60 * 1000));
    const minutes = Math.ceil((resetInMs % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0 && minutes > 0) return `${hours} hour(s) ${minutes} minute(s)`;
    if (hours > 0) return `${hours} hour(s)`;
    return `${minutes} minute(s)`;
}

function tryConsumeGuildSummary(guildId?: string | null): GuildSummaryConsumptionResult {
    if (!guildId) return { allowed: true };

    const now = Date.now();
    const existing = guildSummaryUsage.get(guildId) ?? [];
    const recent = existing.filter(timestamp => now - timestamp <= SUMMARY_WINDOW_MS);

    if (recent.length >= SUMMARY_LIMIT_PER_24H) {
        const oldestTimestamp = Math.min(...recent);
        const resetInMs = SUMMARY_WINDOW_MS - (now - oldestTimestamp);

        Logger.warn(
            `[Summarizer] Guild ${guildId} reached the daily AI summary limit (${SUMMARY_LIMIT_PER_24H}). Next reset in ~${formatResetDuration(resetInMs)}.`
        );
        guildSummaryUsage.set(guildId, recent); // persist pruned timestamps
        return { allowed: false, resetInMs };
    }

    recent.push(now);
    guildSummaryUsage.set(guildId, recent);
    return { allowed: true };
}

/**
 * Fetches the HTML content of a page, attempts to extract the body,
 * and cleans it by removing tags and normalizing whitespace.
 * @param url The URL of the page to fetch.
 * @returns The cleaned text content or null if fetching/parsing fails.
 */
export async function fetchPageContent(url: string): Promise<string | null> {
    try {
        Logger.info(`[FeedSummarizer] Fetching page content for URL: ${url}`);
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'DiscorssBot/1.0 (Feed Summarization)', // More specific UA
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', // Common Accept header
            },
            signal: AbortSignal.timeout(15000), // Add timeout using AbortSignal
        });
        if (!res.ok) {
            Logger.warn(
                `[FeedSummarizer] Failed to fetch page content from ${url}. Status: ${res.status}`
            );
            // Ensure response body is consumed to prevent memory leaks
            try {
                await res.text();
            } catch {
                // Ignore errors when consuming failed response
            }
            // Capture failure in PostHog
            posthog?.capture({
                distinctId: 'system_summarizer',
                event: 'page_fetch_error',
                properties: { url, status: res.status },
            });
            return null;
        }

        // Check content type - Avoid parsing non-HTML content types like images/PDFs
        const contentType = res.headers.get('content-type');
        if (
            contentType &&
            !contentType.includes('text/html') &&
            !contentType.includes('application/xhtml+xml')
        ) {
            Logger.warn(
                `[FeedSummarizer] Skipping non-HTML content type (${contentType}) for URL: ${url}`
            );
            // Ensure response body is consumed to prevent memory leaks
            try {
                await res.text();
            } catch {
                // Ignore errors when consuming response
            }
            return null; // Skip non-html pages
        }

        // Limit HTML content to prevent memory issues
        const fullText = await res.text();
        const maxHtmlLength = 50000; // 50KB max
        const html =
            fullText.length > maxHtmlLength ? fullText.substring(0, maxHtmlLength) : fullText;

        Logger.info(
            `[FeedSummarizer] Fetched HTML for URL: ${url}. Length: ${html.length} (truncated: ${html.length >= 50000})`
        );

        // Use regex-based approach instead of JSDOM for better memory efficiency
        // This avoids creating heavy DOM objects and potential memory leaks
        let cleanedText: string;

        try {
            // Extract content between body tags if available
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            let textContent = bodyMatch ? bodyMatch[1] : html;

            // Remove script and style blocks first
            textContent = textContent
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ');

            // Try to extract main content areas
            const contentPatterns = [
                /<main[^>]*>([\s\S]*?)<\/main>/i,
                /<article[^>]*>([\s\S]*?)<\/article>/i,
                /role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
                /class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
                /id=["']content["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
            ];

            let extractedContent = null;
            for (const pattern of contentPatterns) {
                const match = textContent.match(pattern);
                if (match && match[1] && match[1].length > 500) {
                    extractedContent = match[1];
                    break;
                }
            }

            // Use extracted content or fall back to full text
            const contentToClean = extractedContent || textContent;

            // Remove all HTML tags and clean up
            cleanedText = contentToClean
                .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
                .replace(/&[a-zA-Z0-9#]+;/g, ' ') // Remove HTML entities
                .replace(/<!--[\s\S]*?-->/g, ' ') // Remove HTML comments
                .replace(/\[.*?\]/g, ' ') // Remove markdown-style links [text](url)
                .replace(/\(https?:\/\/[^\s\)]+\)/g, ' ') // Remove URLs in parentheses
                .replace(/https?:\/\/[^\s]+/g, ' ') // Remove standalone URLs
                .replace(/[^\w\s.,!?;:'"()-]/g, ' ') // Remove special characters except basic punctuation
                .replace(/\s+/g, ' ') // Normalize whitespace
                .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
                .trim();
        } catch (regexError) {
            Logger.warn(
                `[FeedSummarizer] Regex parsing failed for ${url}, falling back to simple cleanup`
            );
            cleanedText = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                .replace(/<!--[\s\S]*?-->/g, ' ') // Remove HTML comments
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-zA-Z0-9#]+;/g, ' ') // Remove HTML entities
                .replace(/\[.*?\]/g, ' ') // Remove markdown-style links
                .replace(/\(https?:\/\/[^\s\)]+\)/g, ' ') // Remove URLs in parentheses
                .replace(/https?:\/\/[^\s]+/g, ' ') // Remove standalone URLs
                .replace(/[^\w\s.,!?;:'"()-]/g, ' ') // Remove special characters
                .replace(/\s+/g, ' ') // Normalize whitespace
                .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
                .trim();
        }

        Logger.info(
            `[FeedSummarizer] Extracted content for URL ${url}. Length: ${cleanedText.length}`
        );

        // More aggressive content limiting to reduce memory usage
        const maxLength = Math.min(8000, cleanedText.length); // Reduced from 15000 to 8000
        const result = cleanedText.substring(0, maxLength);

        // Clear variables to help GC
        cleanedText = '';

        return result;
    } catch (error: any) {
        Logger.error(
            `[FeedSummarizer] Error fetching or processing page content from ${url}:`,
            error
        );
        // Capture specific error in PostHog
        posthog?.capture({
            distinctId: 'system_summarizer',
            event: 'page_fetch_exception',
            properties: { url, error: error.message, stack: error.stack },
        });
        return null;
    }
}

/**
 * Summarizes the given content using an AI model via OpenAI.
 * Handles potential errors and structures the prompt carefully.
 */
export async function summarizeContent(
    articleContent: string | null,
    commentsContent: string | null,
    sourceUrl?: string, // Keep sourceUrl optional for flexibility
    language?: string | null, // Language code for the summary (e.g., 'en', 'es', 'fr', 'de')
    guildId?: string | null // Guild ID for PostHog analytics (used as proxy for user)
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
            articleContent,
            'ARTICLE CONTENT',
            sourceUrl,
            language,
            guildId
        );
        // Calculate read time for the original article content
        articleReadTime = calculateReadTime(articleContent);
    }
    if (commentsContent) {
        commentsSummary = await summarizeSingleContent(
            commentsContent,
            'COMMENTS CONTENT',
            sourceUrl,
            language,
            guildId
        );
    }
    return { articleSummary, commentsSummary, articleReadTime };
}

type ModelCallResult =
    | { ok: true; text: string; model: string; durationMs: number; inputTokens: number; outputTokens: number; totalTokens: number }
    | { ok: false; retryable: boolean; error: string };

async function callModel(
    modelName: string,
    prompt: string,
    opts: { contentType: string; sourceUrl?: string; contentLength: number; guildId?: string | null }
): Promise<ModelCallResult> {
    const openAIClient = getOpenAIClient();
    if (!openAIClient) {
        return { ok: false, retryable: false, error: 'No OpenAI client available' };
    }

    const distinctId = opts.guildId || 'system_summarizer';
    const useOpenRouter = !!env.OPENROUTER_API_KEY;
    const startTime = Date.now();

    const requestParams: ChatCompletionCreateParams & {
        posthogDistinctId?: string;
        posthogTraceId?: string;
        posthogProperties?: Record<string, unknown>;
        posthogPrivacyMode?: boolean;
        max_tokens?: number;
        max_completion_tokens?: number;
    } = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        ...(useOpenRouter ? { max_tokens: 300 } : { max_completion_tokens: 1000 }),
    };

    if (posthog) {
        requestParams.posthogDistinctId = distinctId;
        requestParams.posthogTraceId = `trace_${opts.sourceUrl || 'unknown'}_${Date.now()}`;
        requestParams.posthogProperties = {
            contentType: opts.contentType,
            sourceUrl: opts.sourceUrl || undefined,
            contentLength: opts.contentLength,
            guildId: opts.guildId || undefined,
        };
        requestParams.posthogPrivacyMode = false;
    }

    const response = await openAIClient.chat.completions.create(requestParams);
    const durationMs = Date.now() - startTime;

    if (!response.choices?.length) {
        Logger.warn(
            `[Summarizer] No choices returned from ${modelName} for ${opts.sourceUrl}. Response: ${JSON.stringify(response)}`
        );
        return { ok: false, retryable: true, error: 'No choices in response' };
    }

    const choice = response.choices[0];
    const text = choice?.message?.content || '';
    const usage = response.usage;

    return {
        ok: true,
        text,
        model: modelName,
        durationMs,
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
    };
}

async function summarizeSingleContent(
    content: string,
    contentType: 'ARTICLE CONTENT' | 'COMMENTS CONTENT',
    sourceUrl?: string,
    language?: string | null,
    guildId?: string | null
): Promise<string | null> {
    if (!content) {
        Logger.warn(`[Summarizer] No ${contentType} provided for summarization.`);
        return 'Could not generate summary: No content available.';
    }

    const { allowed, resetInMs } = tryConsumeGuildSummary(guildId);
    if (!allowed) {
        const resetText = formatResetDuration(resetInMs);
        return `Could not generate summary: Daily AI summary limit reached (max ${SUMMARY_LIMIT_PER_24H} summaries per guild every 24 hours). The cap resets in about ${resetText}. No AI call was made for this request.`;
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
2.  Generate a brief summary (ideally 2-4 sentences, max 1500 characters) capturing the main points or themes.
3.  Focus on factual information presented. Avoid speculation or adding external knowledge.
4.  **Do NOT include any introductory phrases like "Here is a summary:", "This article discusses:", etc.** Just provide the summary text directly.
5.  **If you cannot determine meaningful content to summarize (e.g., the text is boilerplate, error messages, or nonsensical), respond ONLY with the exact phrase: "Could not generate summary: Insufficient content."**
6.  **If the content appears to primarily be metadata or links (like the description field from an RSS feed often is), DO NOT summarize that metadata.** Use the phrase from instruction 5.
7.  **IMPORTANT: Generate the summary directly without internal reasoning or thinking. Provide only the final summary text.**
${languageInstruction ? languageInstruction + '\n' : ''}
**Content to Summarize:**
${truncatedContent}

**Summary:**
    `;

    const distinctId = guildId || 'system_summarizer';
    const callOpts = { contentType, sourceUrl, contentLength: truncatedContent.length, guildId };
    const modelsToTry = [MODEL_NAME, FALLBACK_MODEL_NAME];
    const sourceLabel = sourceUrl || 'source';

    for (let i = 0; i < modelsToTry.length; i++) {
        const modelName = modelsToTry[i];
        const isFallback = i > 0;
        const attemptLabel = `${i + 1}/${modelsToTry.length}`;

        if (isFallback) {
            Logger.info(
                `[Summarizer] Retrying ${contentType} from ${sourceLabel} with fallback model ${modelName} (attempt ${attemptLabel}).`
            );
        } else {
            Logger.info(
                `[Summarizer] Sending ${contentType} from ${sourceLabel} to primary model ${modelName} (attempt ${attemptLabel}).`
            );
        }

        let result: ModelCallResult;
        try {
            result = await callModel(modelName, prompt, callOpts);
        } catch (error: any) {
            Logger.error(
                `[Summarizer] Error calling ${contentType} from ${sourceLabel} with model ${modelName} (attempt ${attemptLabel}):`,
                error
            );
            posthog?.capture({
                distinctId,
                event: '$exception',
                properties: {
                    $exception_type: 'SummarizationModelError',
                    $exception_message: error instanceof Error ? error.message : String(error),
                    $exception_stack_trace: error instanceof Error ? error.stack : undefined,
                    model: modelName,
                    isFallback,
                    sourceUrl,
                    contentType,
                    guildId: guildId || undefined,
                },
                groups: guildId ? { guild: guildId } : undefined,
            });
            if (i < modelsToTry.length - 1) continue;
            return 'Could not generate summary: Error contacting summarization service.';
        }

        if (result.ok === false) {
            const { error: errMsg, retryable } = result;
            posthog?.capture({
                distinctId,
                event: 'summarization_empty_response',
                properties: {
                    model: modelName,
                    isFallback,
                    sourceUrl,
                    contentType,
                    guildId: guildId || undefined,
                    contentLength: truncatedContent.length,
                    reason: errMsg,
                },
                groups: guildId ? { guild: guildId } : undefined,
            });
            if (retryable && i < modelsToTry.length - 1) continue;
            return 'Could not generate summary: No response from model.';
        }

        const { text, durationMs, inputTokens, outputTokens, totalTokens } = result;

        Logger.info(
            `[Summarizer] Received ${contentType} summary from ${modelName} for ${sourceLabel} (${durationMs}ms, attempt ${attemptLabel}). Length: ${text?.length ?? 0}. Tokens: ${inputTokens} in + ${outputTokens} out = ${totalTokens} total.${isFallback ? ' (fallback)' : ''}`
        );

        if (!text || text.trim().length === 0) {
            Logger.warn(
                `[Summarizer] Received empty ${contentType} summary from ${modelName} for ${sourceLabel} (attempt ${attemptLabel}).`
            );
            posthog?.capture({
                distinctId,
                event: 'summarization_empty_response',
                properties: { model: modelName, isFallback, sourceUrl, contentType, inputTokens, outputTokens, totalTokens, guildId: guildId || undefined, contentLength: truncatedContent.length },
                groups: guildId ? { guild: guildId } : undefined,
            });
            if (i < modelsToTry.length - 1) continue;
            return 'Could not generate summary: Empty response from model.';
        }

        if (text.includes('Could not generate summary:')) {
            Logger.warn(
                `[Summarizer] Model ${modelName} indicated insufficient ${contentType} content for ${sourceLabel} (attempt ${attemptLabel}).`
            );
            posthog?.capture({
                distinctId,
                event: 'summarization_insufficient_content',
                properties: { model: modelName, isFallback, sourceUrl, contentType, inputTokens, outputTokens, totalTokens, guildId: guildId || undefined, contentLength: truncatedContent.length },
                groups: guildId ? { guild: guildId } : undefined,
            });
            return text;
        }

        posthog?.capture({
            distinctId,
            event: 'summarization_success',
            properties: {
                model: modelName,
                isFallback,
                sourceUrl,
                contentLength: truncatedContent.length,
                summaryLength: text.length,
                durationMs,
                contentType,
                inputTokens,
                outputTokens,
                totalTokens,
                guildId: guildId || undefined,
            },
            groups: guildId ? { guild: guildId } : undefined,
        });

        return text.trim();
    }

    return 'Could not generate summary: Error contacting summarization service.';
}
