import { Logger } from '../services/logger.js';
import { EventEmitter } from 'events';

/**
 * Detects common memory leak patterns in Node.js applications
 */
export class LeakDetector {
    private eventEmitterCounts = new Map<EventEmitter, number>();
    private intervalIds = new Set<NodeJS.Timeout>();
    private timeoutIds = new Set<NodeJS.Timeout>();
    private checkInterval: NodeJS.Timeout | null = null;

    start(): void {
        Logger.info('[LeakDetector] Starting leak detection...');

        // Check for leaks every 2 minutes
        this.checkInterval = setInterval(() => {
            this.detectLeaks();
        }, 2 * 60 * 1000);
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        Logger.info('[LeakDetector] Stopped leak detection');
    }

    private detectLeaks(): void {
        this.checkEventEmitterLeaks();
        this.checkTimerLeaks();
        this.checkGlobalLeaks();
    }

    // Detect EventEmitter listener leaks
    private checkEventEmitterLeaks(): void {
        const emitters = this.findEventEmitters();
        let leaksFound = false;

        for (const emitter of emitters) {
            const listenerCount = emitter.listenerCount('*' as any);
            const maxListeners = emitter.getMaxListeners();

            if (listenerCount > maxListeners && maxListeners !== 0) {
                Logger.warn(
                    `[LeakDetector] ⚠️ EventEmitter leak detected: ${listenerCount} listeners (max: ${maxListeners})`
                );
                Logger.warn(`[LeakDetector] EventEmitter: ${emitter.constructor.name}`);
                leaksFound = true;

                // Log event names and counts
                const eventNames = emitter.eventNames();
                for (const eventName of eventNames) {
                    const count = emitter.listenerCount(eventName);
                    if (count > 10) {
                        Logger.warn(`[LeakDetector]   Event "${String(eventName)}": ${count} listeners`);
                    }
                }
            }
        }

        if (!leaksFound) {
            Logger.info('[LeakDetector] ✓ No EventEmitter leaks detected');
        }
    }

    // Find all EventEmitters in the process
    private findEventEmitters(): EventEmitter[] {
        const emitters: EventEmitter[] = [];

        // Check common global objects
        if (process instanceof EventEmitter) {
            emitters.push(process);
        }

        // You can add more specific checks for your application
        // For example, checking Discord.js client, database connections, etc.

        return emitters;
    }

    // Detect timer leaks (setInterval/setTimeout that never clear)
    private checkTimerLeaks(): void {
        // Node.js doesn't expose active timers directly, but we can track them
        // This is a simplified version - in production you'd want to monkey-patch
        // setInterval/setTimeout to track all timers

        const activeHandles = (process as any)._getActiveHandles?.() || [];
        const activeRequests = (process as any)._getActiveRequests?.() || [];

        Logger.info(`[LeakDetector] Active handles: ${activeHandles.length}`);
        Logger.info(`[LeakDetector] Active requests: ${activeRequests.length}`);

        if (activeHandles.length > 100) {
            Logger.warn(
                `[LeakDetector] ⚠️ High number of active handles (${activeHandles.length}) - potential timer leak`
            );
        }

        if (activeRequests.length > 50) {
            Logger.warn(
                `[LeakDetector] ⚠️ High number of active requests (${activeRequests.length}) - potential I/O leak`
            );
        }
    }

    // Detect global variable leaks
    private checkGlobalLeaks(): void {
        const globalKeys = Object.keys(global).filter(
            key =>
                !['console', 'process', 'Buffer', 'clearInterval', 'clearTimeout', 'setInterval', 'setTimeout', 'global'].includes(
                    key
                )
        );

        if (globalKeys.length > 50) {
            Logger.warn(
                `[LeakDetector] ⚠️ High number of global variables (${globalKeys.length}) - potential leak`
            );
            Logger.warn(`[LeakDetector] Global keys: ${globalKeys.slice(0, 20).join(', ')}...`);
        }
    }

    // Track a specific EventEmitter
    trackEventEmitter(emitter: EventEmitter, name: string): void {
        const originalOn = emitter.on.bind(emitter);
        const originalAddListener = emitter.addListener.bind(emitter);
        const originalRemoveListener = emitter.removeListener.bind(emitter);

        let listenerCount = 0;

        emitter.on = function (event: string | symbol, listener: (...args: any[]) => void) {
            listenerCount++;
            Logger.info(`[LeakDetector] ${name} added listener for "${String(event)}" (total: ${listenerCount})`);
            return originalOn(event, listener);
        } as any;

        emitter.addListener = emitter.on;

        emitter.removeListener = function (event: string | symbol, listener: (...args: any[]) => void) {
            listenerCount--;
            Logger.info(`[LeakDetector] ${name} removed listener for "${String(event)}" (total: ${listenerCount})`);
            return originalRemoveListener(event, listener);
        } as any;
    }
}

export const leakDetector = new LeakDetector();

/**
 * Monkey-patch setInterval and setTimeout to track all timers
 */
export function enableTimerTracking(): void {
    const timers = new Map<NodeJS.Timeout, { type: 'interval' | 'timeout'; stack: string }>();

    const originalSetInterval = global.setInterval;
    const originalSetTimeout = global.setTimeout;
    const originalClearInterval = global.clearInterval;
    const originalClearTimeout = global.clearTimeout;

    (global as any).setInterval = function (callback: (...args: any[]) => void, ms: number, ...args: any[]) {
        const timer = originalSetInterval(callback, ms, ...args);
        timers.set(timer, { type: 'interval', stack: new Error().stack || '' });
        return timer;
    };

    (global as any).setTimeout = function (callback: (...args: any[]) => void, ms: number, ...args: any[]) {
        const timer = originalSetTimeout(callback, ms, ...args);
        timers.set(timer, { type: 'timeout', stack: new Error().stack || '' });
        return timer;
    };

    (global as any).clearInterval = function (timer: NodeJS.Timeout) {
        timers.delete(timer);
        return originalClearInterval(timer);
    };

    (global as any).clearTimeout = function (timer: NodeJS.Timeout) {
        timers.delete(timer);
        return originalClearTimeout(timer);
    };

    // Log timer stats periodically
    setInterval(() => {
        const intervals = Array.from(timers.values()).filter(t => t.type === 'interval').length;
        const timeouts = Array.from(timers.values()).filter(t => t.type === 'timeout').length;

        Logger.info(`[TimerTracker] Active timers - Intervals: ${intervals}, Timeouts: ${timeouts}`);

        if (intervals > 50) {
            Logger.warn(`[TimerTracker] ⚠️ High number of active intervals (${intervals})`);
        }
    }, 5 * 60 * 1000); // Every 5 minutes
}
