import { Logger } from '../services/logger.js';
import { writeFileSync } from 'fs';
import { posthog } from './analytics.js';

interface MemorySnapshot {
    timestamp: number;
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
}

interface MemoryStats {
    current: MemorySnapshot;
    peak: MemorySnapshot;
    snapshots: MemorySnapshot[];
    leakDetected: boolean;
    growthRate: number; // MB per minute
}

class MemoryProfiler {
    private snapshots: MemorySnapshot[] = [];
    private peakMemory: MemorySnapshot | null = null;
    private startTime: number = Date.now();
    private monitoringInterval: NodeJS.Timeout | null = null;
    private readonly MAX_SNAPSHOTS = 1000; // Keep last 1000 snapshots
    private readonly SNAPSHOT_INTERVAL = 30000; // 30 seconds
    private readonly LEAK_THRESHOLD_MB_PER_MIN = 5; // 5MB/min growth = potential leak

    start(): void {
        Logger.info('[MemoryProfiler] Starting memory profiling...');
        this.startTime = Date.now();
        this.takeSnapshot(); // Initial snapshot

        this.monitoringInterval = setInterval(() => {
            this.takeSnapshot();
            this.analyzeMemoryTrend();
        }, this.SNAPSHOT_INTERVAL);
    }

    stop(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        Logger.info('[MemoryProfiler] Stopped memory profiling');
    }

    private takeSnapshot(): MemorySnapshot {
        const mem = process.memoryUsage();
        const snapshot: MemorySnapshot = {
            timestamp: Date.now(),
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers,
        };

        this.snapshots.push(snapshot);

        // Keep only recent snapshots
        if (this.snapshots.length > this.MAX_SNAPSHOTS) {
            this.snapshots.shift();
        }

        // Update peak memory
        if (!this.peakMemory || snapshot.heapUsed > this.peakMemory.heapUsed) {
            this.peakMemory = snapshot;
        }

        return snapshot;
    }

    private analyzeMemoryTrend(): void {
        if (this.snapshots.length < 10) return; // Need at least 10 snapshots

        const recent = this.snapshots.slice(-10);
        const oldest = recent[0];
        const newest = recent[recent.length - 1];

        const timeDiffMinutes = (newest.timestamp - oldest.timestamp) / 1000 / 60;
        const heapGrowthMB = (newest.heapUsed - oldest.heapUsed) / 1024 / 1024;
        const growthRate = heapGrowthMB / timeDiffMinutes;

        if (growthRate > this.LEAK_THRESHOLD_MB_PER_MIN) {
            Logger.warn(
                `[MemoryProfiler] ⚠️ POTENTIAL MEMORY LEAK DETECTED! Growth rate: ${growthRate.toFixed(2)} MB/min`
            );
            Logger.warn(
                `[MemoryProfiler] Heap: ${(oldest.heapUsed / 1024 / 1024).toFixed(2)}MB → ${(newest.heapUsed / 1024 / 1024).toFixed(2)}MB over ${timeDiffMinutes.toFixed(1)} minutes`
            );

            // Capture in PostHog
            posthog?.capture({
                distinctId: 'system_memory_profiler',
                event: 'memory_leak_detected',
                properties: {
                    growthRateMBPerMin: growthRate,
                    heapUsedMB: newest.heapUsed / 1024 / 1024,
                    rssMB: newest.rss / 1024 / 1024,
                    timeDiffMinutes,
                },
            });

            // Take heap snapshot if available
            this.takeHeapSnapshot();
        }
    }

    getStats(): MemoryStats {
        const current = this.snapshots[this.snapshots.length - 1] || this.takeSnapshot();
        const peak = this.peakMemory || current;

        // Calculate growth rate over last 10 minutes
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        const recentSnapshots = this.snapshots.filter(s => s.timestamp > tenMinutesAgo);
        let growthRate = 0;

        if (recentSnapshots.length >= 2) {
            const oldest = recentSnapshots[0];
            const newest = recentSnapshots[recentSnapshots.length - 1];
            const timeDiffMinutes = (newest.timestamp - oldest.timestamp) / 1000 / 60;
            const heapGrowthMB = (newest.heapUsed - oldest.heapUsed) / 1024 / 1024;
            growthRate = heapGrowthMB / timeDiffMinutes;
        }

        return {
            current,
            peak,
            snapshots: this.snapshots,
            leakDetected: growthRate > this.LEAK_THRESHOLD_MB_PER_MIN,
            growthRate,
        };
    }

    private takeHeapSnapshot(): void {
        try {
            if (typeof global.gc === 'function') {
                Logger.info('[MemoryProfiler] Running garbage collection before heap snapshot...');
                global.gc();
            }

            // Use v8 heapsnapshot if available
            const v8 = require('v8');
            if (v8.writeHeapSnapshot) {
                const filename = `/tmp/heap-${Date.now()}.heapsnapshot`;
                v8.writeHeapSnapshot(filename);
                Logger.info(`[MemoryProfiler] Heap snapshot saved to ${filename}`);
                Logger.info(
                    '[MemoryProfiler] Analyze with Chrome DevTools: chrome://inspect → Memory → Load'
                );
            }
        } catch (error) {
            Logger.error('[MemoryProfiler] Failed to take heap snapshot:', error);
        }
    }

    exportSnapshots(filename: string): void {
        try {
            const data = JSON.stringify(this.snapshots, null, 2);
            writeFileSync(filename, data);
            Logger.info(`[MemoryProfiler] Exported ${this.snapshots.length} snapshots to ${filename}`);
        } catch (error) {
            Logger.error(`[MemoryProfiler] Failed to export snapshots:`, error);
        }
    }

    logDetailedReport(): void {
        const stats = this.getStats();
        const uptimeMinutes = (Date.now() - this.startTime) / 1000 / 60;

        Logger.info('='.repeat(80));
        Logger.info('[MemoryProfiler] DETAILED MEMORY REPORT');
        Logger.info('='.repeat(80));
        Logger.info(`Uptime: ${uptimeMinutes.toFixed(1)} minutes`);
        Logger.info(`Snapshots collected: ${this.snapshots.length}`);
        Logger.info('');
        Logger.info('CURRENT MEMORY:');
        Logger.info(`  RSS:          ${(stats.current.rss / 1024 / 1024).toFixed(2)} MB`);
        Logger.info(`  Heap Total:   ${(stats.current.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        Logger.info(`  Heap Used:    ${(stats.current.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        Logger.info(`  External:     ${(stats.current.external / 1024 / 1024).toFixed(2)} MB`);
        Logger.info(`  Array Buffers: ${(stats.current.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);
        Logger.info('');
        Logger.info('PEAK MEMORY:');
        Logger.info(`  RSS:          ${(stats.peak.rss / 1024 / 1024).toFixed(2)} MB`);
        Logger.info(`  Heap Used:    ${(stats.peak.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        Logger.info('');
        Logger.info('MEMORY TREND:');
        Logger.info(`  Growth Rate:  ${stats.growthRate.toFixed(2)} MB/min`);
        Logger.info(`  Leak Status:  ${stats.leakDetected ? '⚠️ LEAK DETECTED' : '✓ Normal'}`);
        Logger.info('='.repeat(80));
    }

    // Force garbage collection and log before/after
    forceGC(): void {
        if (typeof global.gc !== 'function') {
            Logger.warn('[MemoryProfiler] GC not available. Run with --expose-gc flag');
            return;
        }

        const before = process.memoryUsage();
        Logger.info(
            `[MemoryProfiler] Before GC - Heap: ${(before.heapUsed / 1024 / 1024).toFixed(2)} MB`
        );

        global.gc();

        const after = process.memoryUsage();
        const freed = (before.heapUsed - after.heapUsed) / 1024 / 1024;
        Logger.info(
            `[MemoryProfiler] After GC - Heap: ${(after.heapUsed / 1024 / 1024).toFixed(2)} MB (freed ${freed.toFixed(2)} MB)`
        );

        posthog?.capture({
            distinctId: 'system_memory_profiler',
            event: 'manual_gc',
            properties: {
                beforeHeapMB: before.heapUsed / 1024 / 1024,
                afterHeapMB: after.heapUsed / 1024 / 1024,
                freedMB: freed,
            },
        });
    }
}

// Singleton instance
export const memoryProfiler = new MemoryProfiler();

// Helper function to get human-readable memory info
export function getMemoryInfo(): string {
    const mem = process.memoryUsage();
    return [
        `RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
        `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} / ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        `External: ${(mem.external / 1024 / 1024).toFixed(2)} MB`,
        `ArrayBuffers: ${(mem.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
    ].join(' | ');
}

// Track object allocations (for debugging specific leaks)
export class ObjectTracker {
    private trackedObjects = new WeakMap<object, string>();
    private allocationCounts = new Map<string, number>();

    track(obj: object, label: string): void {
        this.trackedObjects.set(obj, label);
        this.allocationCounts.set(label, (this.allocationCounts.get(label) || 0) + 1);
    }

    getStats(): Map<string, number> {
        return new Map(this.allocationCounts);
    }

    logStats(): void {
        Logger.info('[ObjectTracker] Allocation counts:');
        for (const [label, count] of this.allocationCounts.entries()) {
            Logger.info(`  ${label}: ${count}`);
        }
    }

    reset(): void {
        this.allocationCounts.clear();
    }
}

export const objectTracker = new ObjectTracker();
