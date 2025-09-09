/**
 * Calculates the estimated read time for a given text content.
 * Uses the standard reading speed of 200-250 words per minute for average readers.
 */

const WORDS_PER_MINUTE = 225; // Average reading speed for adults
const MIN_READ_TIME = 1; // Minimum read time in minutes

/**
 * Calculates read time in minutes based on word count
 * @param text The text content to analyze
 * @returns Read time in minutes (minimum 1 minute)
 */
export function calculateReadTime(text: string): number {
    if (!text || text.trim().length === 0) {
        return MIN_READ_TIME;
    }

    // Count words by splitting on whitespace and filtering out empty strings
    const wordCount = text
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0).length;

    // Calculate read time in minutes, rounded up to nearest minute
    const readTimeMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);

    // Ensure minimum read time
    return Math.max(readTimeMinutes, MIN_READ_TIME);
}

/**
 * Formats read time as a human-readable string
 * @param minutes The read time in minutes
 * @returns Formatted read time string (e.g., "3 min read", "1 min read")
 */
export function formatReadTime(minutes: number): string {
    return `${minutes} min read`;
}

/**
 * Calculates and formats read time in one function
 * @param text The text content to analyze
 * @returns Formatted read time string in italics for Discord
 */
export function getFormattedReadTime(text: string): string {
    const readTime = calculateReadTime(text);
    return `*${formatReadTime(readTime)}*`;
}
