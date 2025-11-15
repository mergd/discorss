// @ts-ignore - Package exports not fully supported by TypeScript moduleResolution
import { OpenAI as PostHogOpenAI } from '@posthog/ai/openai';
import { OpenAI } from 'openai';
import { posthog } from '../utils/analytics.js';
import { env } from '../utils/env.js';

let openAIClient: OpenAI | PostHogOpenAI | null = null;

export function getOpenAIClient(): OpenAI | PostHogOpenAI | null {
    if (!env.OPENAI_API_KEY) {
        return null;
    }

    if (!openAIClient) {
        if (posthog) {
            openAIClient = new PostHogOpenAI({
                apiKey: env.OPENAI_API_KEY,
                posthog: posthog,
            });
        } else {
            openAIClient = new OpenAI({
                apiKey: env.OPENAI_API_KEY,
            });
        }
    }

    return openAIClient;
}

