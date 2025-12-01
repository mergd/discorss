// @ts-ignore - Package exports not fully supported by TypeScript moduleResolution
import { OpenAI as PostHogOpenAI } from '@posthog/ai/openai';
import { OpenAI } from 'openai';
import { posthog } from '../utils/analytics.js';
import { env } from '../utils/env.js';

let openAIClient: OpenAI | PostHogOpenAI | null = null;

export function resetOpenAIClient(): void {
    openAIClient = null;
}

export function getOpenAIClient(): OpenAI | PostHogOpenAI | null {
    const apiKey = env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) {
        return null;
    }

    if (!openAIClient) {
        const useOpenRouter = !!env.OPENROUTER_API_KEY;
        const baseURL = useOpenRouter ? 'https://openrouter.ai/api/v1' : undefined;

        if (posthog) {
            openAIClient = new PostHogOpenAI({
                apiKey: apiKey,
                posthog: posthog,
                baseURL: baseURL,
                defaultHeaders: useOpenRouter
                    ? {
                          'HTTP-Referer': 'https://github.com/mergd/discorss',
                          'X-Title': 'Discorss Bot',
                      }
                    : undefined,
            });
        } else {
            openAIClient = new OpenAI({
                apiKey: apiKey,
                baseURL: baseURL,
                defaultHeaders: useOpenRouter
                    ? {
                          'HTTP-Referer': 'https://github.com/mergd/discorss',
                          'X-Title': 'Discorss Bot',
                      }
                    : undefined,
            });
        }
    }

    return openAIClient;
}
