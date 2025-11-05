# Memory Leak Analysis & Debugging Guide

## 🔍 Overview

This document provides a comprehensive analysis of potential memory leaks in the Discorss bot and tools to debug them.

## 📊 Timeline

**Regression started:** September 16, 2025

**Key commits around that time:**
- `71a2c90` - Merge PR #6: Decrease memory usage to prevent OOM
- `d3f67ae` - Process feed summaries sequentially to lower memory
- `6cdeaf0` - feat: lower memory usage

**Paradox:** Memory optimization efforts may have introduced new leaks or masked existing ones.

## 🚨 Common Memory Leak Patterns in Discord Bots

### 1. **Event Listener Leaks**
**Symptoms:** Growing number of event listeners on EventEmitters
**Causes:**
- Not removing listeners when components are destroyed
- Re-registering listeners without cleanup
- Discord.js client event listeners not being cleaned up

**Check:**
```typescript
// In your code, look for:
client.on('event', handler) // without corresponding .off() or .removeListener()
```

### 2. **Timer Leaks (setInterval/setTimeout)**
**Symptoms:** Memory grows steadily over time
**Causes:**
- `setInterval` in `feed-poll-job.ts` (line 187) - batch processor
- Timers not being cleared on shutdown
- Multiple timers created for the same purpose

**Current timers in codebase:**
- `batchProcessorInterval` in FeedPollJob (line 58, 187)
- Memory report interval in start-manager.ts (line 39)
- Leak detector interval (leak-detector.ts)

### 3. **Closure Leaks**
**Symptoms:** Objects referenced in closures never get garbage collected
**Causes:**
- Large objects captured in `broadcastEval` closures (feed-poll-job.ts lines 590-824)
- Feed items with summaries stored in closures
- Context objects passed to shards

**High-risk areas:**
```typescript
// feed-poll-job.ts line 590
await this.manager.broadcastEval(
    async (client, context) => {
        // This entire context is serialized and sent to each shard
        // Large objects here = memory leak
        const { itemsToSendWithSummaries } = context; // Could be large!
    },
    { context: { ... } }
);
```

### 4. **Cache Buildup**
**Symptoms:** Maps/Sets grow unbounded
**Causes:**
- `feedQueue` Map (line 57) - never fully cleared, only individual items removed
- `categoryFrequencies` Map (line 55) - cleared but could grow large
- Discord.js caches (configured in config.json but may not be effective)

### 5. **Database Connection Leaks**
**Symptoms:** Connection pool exhaustion, memory growth
**Current mitigation:**
- Pool size reduced to 3 (db/index.ts line 14)
- Prepared statements disabled (line 18)
- Idle timeout set to 10s (line 15)

**Potential issues:**
- Queries not being properly awaited
- Transactions not being committed/rolled back

### 6. **String/Buffer Accumulation**
**Symptoms:** External memory or Array Buffers growing
**Causes:**
- RSS feed content accumulation
- HTML content from `fetchPageContent` (feed-summarizer.ts)
- Large strings in summarization

**Current mitigation:**
- HTML limited to 50KB (line 74)
- Content limited to 8000 chars (line 141)
- Response bodies consumed (lines 38-43, 63-68)

### 7. **Shared Singleton Leaks**
**Symptoms:** Singletons accumulate state over time
**Current singletons:**
- `sharedParser` (rss-parser.ts line 4) - RSS parser instance
- `feedQueue` Map (feed-poll-job.ts line 57)
- `categoryFrequencies` Map (feed-poll-job.ts line 55)

## 🔧 Debugging Tools Now Available

### 1. Memory Profiler (`src/utils/memory-profiler.ts`)
**Features:**
- Automatic memory snapshots every 30 seconds
- Leak detection (>5MB/min growth)
- Peak memory tracking
- Heap snapshot generation
- PostHog integration for alerts

**Usage:**
```bash
# Enable in production
ENABLE_MEMORY_PROFILING=true npm start

# Or use dev command
/dev memory
```

### 2. Leak Detector (`src/utils/leak-detector.ts`)
**Features:**
- EventEmitter listener tracking
- Timer leak detection
- Global variable leak detection
- Active handle/request monitoring

**Usage:**
```typescript
import { leakDetector } from './utils/leak-detector.js';
leakDetector.start();
```

### 3. Dev Commands
**New commands added:**
- `/dev memory` - View current memory stats and leak status
- `/dev heap-snapshot` - Generate heap snapshot for Chrome DevTools
- `/dev force-gc` - Force garbage collection and see what's freed

### 4. Timer Tracking
**Enable with:**
```typescript
import { enableTimerTracking } from './utils/leak-detector.js';
enableTimerTracking(); // Logs all setInterval/setTimeout calls
```

## 🎯 Specific Areas to Investigate

### Priority 1: Feed Poll Job (feed-poll-job.ts)

**Potential leaks:**

1. **broadcastEval context objects** (lines 590-824)
   - Each feed item sends full summary text to all shards
   - Context includes: title, link, summaries (up to 1500 chars each)
   - With 100 feeds × 5 items × 3 shards = 1500 context objects in memory

2. **feedQueue Map** (line 57)
   - Never fully cleared, only individual items removed
   - Could accumulate deleted feeds if removal fails
   - Stores full FeedPollConfig objects

3. **Batch processor closure** (line 187)
   - setInterval creates closure over entire class scope
   - May prevent garbage collection of old feed data

**Recommended fixes:**
```typescript
// 1. Clear feedQueue periodically
if (cycleCount % 100 === 0) {
    // Remove feeds that haven't been checked in 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [feedId, item] of feedQueue) {
        if (item.nextCheck < oneDayAgo) {
            feedQueue.delete(feedId);
        }
    }
}

// 2. Reduce broadcastEval payload size
// Only send essential data, truncate summaries more aggressively
itemsToSendWithSummaries: itemsToSend.map(item => ({
    title: item.title?.substring(0, 150),
    link: item.link,
    // ... truncate summaries to 500 chars instead of 1500
}))

// 3. Nullify large objects after use
articleContent = null;
commentsContent = null;
```

### Priority 2: RSS Parser & Feed Summarizer

**Potential leaks:**

1. **Shared RSS parser** (rss-parser.ts)
   - Single instance used across all feeds
   - May accumulate internal state
   - No periodic reset

2. **fetch() response bodies** (feed-summarizer.ts)
   - Lines 38-43, 63-68 attempt to consume bodies
   - May not handle all error cases
   - Could leave streams open

**Recommended fixes:**
```typescript
// 1. Reset RSS parser periodically
if (cycleCount % 50 === 0) {
    resetRSSParser(); // Already exists, just call it more often
}

// 2. Ensure all fetch responses are consumed
try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    // Always consume body, even on error
    const text = await res.text();
    if (!res.ok) return null;
    // ... process text
} finally {
    // Ensure cleanup
}
```

### Priority 3: Discord.js Client Caches

**Current configuration** (config.json):
```json
"caches": {
    "MessageManager": 0,
    "ThreadManager": 0,
    // ... many set to 0
}
```

**Potential issues:**
- Some caches not disabled (GuildManager, ChannelManager, UserManager)
- Partials may cause cache buildup
- Shard-level caches not cleared

**Recommended fixes:**
```typescript
// In start-bot.ts, add periodic cache clearing
setInterval(() => {
    client.guilds.cache.sweep(() => true); // Clear all
    client.channels.cache.sweep(() => true);
    client.users.cache.sweep(() => true);
}, 30 * 60 * 1000); // Every 30 minutes
```

## 📈 Monitoring Strategy

### 1. Enable Profiling in Production
```bash
# Add to your start script
NODE_OPTIONS="--expose-gc --max-old-space-size=2048" \
ENABLE_MEMORY_PROFILING=true \
npm start
```

### 2. Set Up Alerts
The memory profiler automatically sends PostHog events when:
- Memory growth exceeds 5MB/min
- Heap snapshots are taken
- Manual GC is triggered

### 3. Regular Heap Snapshots
Take heap snapshots at different times:
- Right after startup
- After 1 hour of operation
- After 24 hours of operation
- When memory usage is high

Compare snapshots to find:
- Objects that grow over time
- Detached DOM nodes (shouldn't exist in bot)
- Large strings/buffers
- Retained closures

### 4. Log Analysis
Look for patterns in logs:
- `[FeedPollJob] Feed queue size` - should be stable
- `[FeedPollJob] Memory usage` - should not grow linearly
- `[MemoryProfiler] POTENTIAL MEMORY LEAK DETECTED` - investigate immediately

## 🔬 How to Use Heap Snapshots

1. **Take snapshot:**
   ```bash
   /dev heap-snapshot
   ```

2. **Download from server:**
   ```bash
   scp server:/tmp/heap-*.heapsnapshot ./
   ```

3. **Analyze in Chrome DevTools:**
   - Open `chrome://inspect`
   - Go to Memory tab
   - Click "Load" and select the `.heapsnapshot` file
   - Switch to "Comparison" view if you have multiple snapshots
   - Look for:
     - Objects with high "Retained Size"
     - Objects that appear in later snapshots but not earlier ones
     - Detached event listeners
     - Large strings or arrays

4. **Common culprits to look for:**
   - `(array)` - Large arrays that shouldn't exist
   - `(string)` - Accumulated strings
   - `(closure)` - Functions holding references
   - `Map` / `Set` - Growing collections
   - `EventEmitter` - Listeners not removed

## 🚀 Quick Wins

### Immediate Actions:

1. **Add aggressive cache clearing:**
   ```typescript
   // In feed-poll-job.ts, add to batch processor
   if (cycleCount % 20 === 0) { // Every 10 minutes
       feedQueue.clear();
       await this.loadAndScheduleFeeds(); // Reload from DB
   }
   ```

2. **Reduce broadcastEval payload:**
   ```typescript
   // Truncate summaries more aggressively
   articleSummary: item.articleSummary?.substring(0, 500),
   commentsSummary: item.commentsSummary?.substring(0, 500),
   ```

3. **Reset RSS parser more often:**
   ```typescript
   // In feed-poll-job.ts
   if (cycleCount % 50 === 0) {
       const { resetRSSParser } = await import('../utils/rss-parser.js');
       resetRSSParser();
   }
   ```

4. **Clear Discord.js caches:**
   ```typescript
   // In start-bot.ts
   setInterval(() => {
       if (client.isReady()) {
           client.sweepMessages();
           client.guilds.cache.clear();
           client.channels.cache.clear();
       }
   }, 15 * 60 * 1000);
   ```

## 📝 Next Steps

1. **Deploy with profiling enabled** and monitor for 24 hours
2. **Take heap snapshots** at startup, 1hr, 6hr, 24hr
3. **Compare snapshots** to identify growing objects
4. **Check PostHog** for leak detection events
5. **Review logs** for memory growth patterns
6. **Implement fixes** based on findings
7. **Re-test** with profiling enabled

## 🆘 If Memory Keeps Growing

If memory continues to grow despite these tools:

1. **Enable timer tracking** to find unclosed intervals
2. **Use heap snapshots** to find the largest objects
3. **Check for circular references** in feed data
4. **Review recent code changes** around 9/16/25
5. **Consider reverting** the "sequential processing" change from commit d3f67ae
6. **Profile with clinic.js** for deeper analysis:
   ```bash
   npm install -g clinic
   clinic doctor -- node --expose-gc dist/start-manager.js
   ```

## 📚 Resources

- [Node.js Memory Leak Debugging](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Chrome DevTools Heap Profiler](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Discord.js Memory Optimization](https://discordjs.guide/popular-topics/common-questions.html#how-do-i-reduce-memory-usage)
