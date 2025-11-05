// @ts-ignore - Package exports not fully supported by TypeScript moduleResolution
import { OpenAI } from '@posthog/ai/openai';
import { posthog } from '../utils/analytics.js';
import { env } from '../utils/env.js';

let openAIClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
    if (!posthog || !env.OPENROUTER_API_KEY) {
        return null;
    }

    if (!openAIClient) {
        openAIClient = new OpenAI({
            apiKey: env.OPENROUTER_API_KEY,
            baseURL: 'https://openrouter.ai/api/v1',
            posthog: posthog,
        });
    }

    return openAIClient;
}

