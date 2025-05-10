import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import fetch from 'node-fetch';
import { MODEL_NAME } from '../constants/misc.js';
import { Logger } from '../services/logger.js'; // Added Logger
import { posthog } from './analytics.js'; // Import posthog
import { env } from './env.js';

// Initialize OpenRouter Client
const openrouter = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
});

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
            return null; // Skip non-html pages
        }

        const html = await res.text();
        Logger.info(
            `[FeedSummarizer] Successfully fetched HTML for URL: ${url}. Length: ${html.length}`
        );

        // Attempt to extract body content first
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        let textContent = '';

        if (bodyMatch && bodyMatch[1]) {
            textContent = bodyMatch[1];
            // Logger.info(`[FeedSummarizer] Extracted body content for URL: ${url}.`); // Less verbose logging
        } else {
            // Fallback to using the whole HTML if body tag isn't found
            textContent = html;
            Logger.info(`[FeedSummarizer] Body tag not found, using full HTML for URL: ${url}.`);
        }

        // Basic cleaning: remove script/style tags, then all other tags, normalize whitespace
        const cleanedText = textContent
            .replace(/<script[^>]*>.*?<\/script>/gis, ' ') // Remove script blocks
            .replace(/<style[^>]*>.*?<\/style>/gis, ' ') // Remove style blocks
            .replace(/<[^>]+>/g, ' ') // Remove remaining HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        // Logger.info(`[FeedSummarizer] Cleaned text length for URL ${url}: ${cleanedText.length}`); // Less verbose logging
        return cleanedText.substring(0, 15000); // Limit content length
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
 * Summarizes the given content using an AI model via OpenRouter.
 * Handles potential errors and structures the prompt carefully.
 */
export async function summarizeContent(
    articleContent: string | null,
    commentsContent: string | null,
    sourceUrl?: string // Keep sourceUrl optional for flexibility
): Promise<{ articleSummary: string | null; commentsSummary: string | null }> {
    let articleSummary: string | null = null;
    let commentsSummary: string | null = null;

    if (articleContent) {
        articleSummary = await summarizeSingleContent(articleContent, 'ARTICLE CONTENT', sourceUrl);
    }
    if (commentsContent) {
        commentsSummary = await summarizeSingleContent(
            commentsContent,
            'COMMENTS CONTENT',
            sourceUrl
        );
    }
    return { articleSummary, commentsSummary };
}

async function summarizeSingleContent(
    content: string,
    contentType: 'ARTICLE CONTENT' | 'COMMENTS CONTENT',
    sourceUrl?: string
): Promise<string | null> {
    if (!content) {
        Logger.warn(`[Summarizer] No ${contentType} provided for summarization.`);
        return 'Could not generate summary: No content available.';
    }

    const model = openrouter(MODEL_NAME);
    const maxInputLength = 15000;
    const truncatedContent =
        content.length > maxInputLength
            ? content.substring(0, maxInputLength) + '\n[Content Truncated]'
            : content;
    const prompt = `
You are an expert summarizer for Discord bot messages. Your task is to create a concise, neutral, and informative summary of the provided text.

**Instructions:**
1.  Analyze the provided ${contentType}.
2.  Generate a brief summary (ideally 2-4 sentences, max 1500 characters) capturing the main points or themes.
3.  Focus on factual information presented. Avoid speculation or adding external knowledge.
4.  **Do NOT include any introductory phrases like "Here is a summary:", "This article discusses:", etc.** Just provide the summary text directly.
5.  **If you cannot determine meaningful content to summarize (e.g., the text is boilerplate, error messages, or nonsensical), respond ONLY with the exact phrase: "Could not generate summary: Insufficient content."**
6.  **If the content appears to primarily be metadata or links (like the description field from an RSS feed often is), DO NOT summarize that metadata.** Use the phrase from instruction 5.

**Content to Summarize:**
${truncatedContent}

**Summary:**
    `;
    try {
        Logger.info(
            `[Summarizer] Sending ${contentType} from ${sourceUrl || 'source'} to ${MODEL_NAME}...`
        );
        const startTime = Date.now();
        const { text } = await generateText({
            model: model,
            prompt: prompt,
            maxTokens: 300,
            temperature: 0.3,
        });
        const duration = Date.now() - startTime;
        Logger.info(
            `[Summarizer] Received summary from ${MODEL_NAME} (${duration}ms). Length: ${text?.length ?? 0}`
        );
        if (!text || text.trim().length === 0) {
            Logger.warn(`[Summarizer] Received empty summary from ${MODEL_NAME}.`);
            posthog?.capture({
                distinctId: 'system_summarizer',
                event: 'summarization_empty_response',
                properties: { model: MODEL_NAME, sourceUrl, contentType },
            });
            return 'Could not generate summary: Empty response from model.';
        }
        if (text.includes('Could not generate summary:')) {
            Logger.warn(`[Summarizer] Model indicated insufficient content for ${sourceUrl}.`);
            posthog?.capture({
                distinctId: 'system_summarizer',
                event: 'summarization_insufficient_content',
                properties: { model: MODEL_NAME, sourceUrl, contentType },
            });
            return text;
        }
        posthog?.capture({
            distinctId: 'system_summarizer',
            event: 'summarization_success',
            properties: {
                model: MODEL_NAME,
                sourceUrl: sourceUrl,
                contentLength: truncatedContent.length,
                summaryLength: text.length,
                durationMs: duration,
                contentType,
            },
        });
        return text.trim();
    } catch (error: any) {
        Logger.error(`[Summarizer] Error calling OpenRouter model ${MODEL_NAME}:`, error);
        posthog?.capture({
            distinctId: 'system_summarizer',
            event: '$exception',
            properties: {
                $exception_type: 'SummarizationModelError',
                $exception_message: error instanceof Error ? error.message : String(error),
                $exception_stack_trace: error instanceof Error ? error.stack : undefined,
                model: MODEL_NAME,
                sourceUrl: sourceUrl,
                contentType,
            },
        });
        return 'Could not generate summary: Error contacting summarization service.';
    }
}
