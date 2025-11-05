# 🔍 Memory Debugging Quick Start Guide

## TL;DR - Quick Commands

```bash
# 1. Enable memory profiling
ENABLE_MEMORY_PROFILING=true npm start

# 2. Check memory in Discord
/dev memory

# 3. Take heap snapshot
/dev heap-snapshot

# 4. Monitor memory over time
./scripts/analyze-memory.sh monitor 3600

# 5. Force garbage collection
/dev force-gc
```

## 🚨 What Changed on 9/16/25?

Around September 16, 2025, several memory optimization commits were made:
- **d3f67ae**: Process feed summaries sequentially to lower memory
- **6cdeaf0**: Lower memory usage
- **71a2c90**: Merge PR #6 to decrease memory usage

**Paradoxically, these "optimizations" may have introduced new leaks.**

## 🎯 Top 3 Likely Culprits

### 1. **broadcastEval Payload Size** (feed-poll-job.ts)
**Problem:** Each feed item sends up to 3KB of data to every shard
**Impact:** With 100 feeds × 5 items × 3 shards = 1.5MB per batch
**Fix:**
```typescript
// Truncate summaries more aggressively
articleSummary: item.articleSummary?.substring(0, 500), // was 1500
commentsSummary: item.commentsSummary?.substring(0, 500),
```

### 2. **feedQueue Map Never Fully Cleared** (feed-poll-job.ts:57)
**Problem:** Deleted feeds may remain in memory
**Impact:** Grows over time as feeds are added/removed
**Fix:**
```typescript
// Add to batch processor (line ~220)
if (cycleCount % 100 === 0) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [feedId, item] of feedQueue) {
        if (item.nextCheck < oneDayAgo) {
            feedQueue.delete(feedId);
        }
    }
}
```

### 3. **RSS Parser State Accumulation** (rss-parser.ts)
**Problem:** Shared parser instance never reset
**Impact:** Internal state may grow over time
**Fix:**
```typescript
// In feed-poll-job.ts batch processor
if (cycleCount % 50 === 0) {
    const { resetRSSParser } = await import('../utils/rss-parser.js');
    resetRSSParser();
}
```

## 🛠️ Tools Now Available

### 1. Memory Profiler
**Location:** `src/utils/memory-profiler.ts`

**Features:**
- ✅ Automatic snapshots every 30s
- ✅ Leak detection (>5MB/min growth)
- ✅ Peak memory tracking
- ✅ PostHog alerts
- ✅ Heap snapshot generation

**Enable:**
```bash
# Development
NODE_ENV=development npm start

# Production
ENABLE_MEMORY_PROFILING=true npm start
```

### 2. Leak Detector
**Location:** `src/utils/leak-detector.ts`

**Detects:**
- EventEmitter listener leaks
- Timer leaks (setInterval/setTimeout)
- Global variable leaks
- Active handle/request leaks

**Auto-enabled** when memory profiling is on.

### 3. Dev Commands

#### `/dev memory`
Shows current memory stats and leak detection status.

**Output:**
- Current memory (RSS, Heap, External, ArrayBuffers)
- Peak memory
- Growth rate (MB/min)
- Leak status

#### `/dev heap-snapshot`
Generates a heap snapshot for Chrome DevTools analysis.

**Steps:**
1. Run `/dev heap-snapshot`
2. Download `/tmp/heap-*.heapsnapshot` from server
3. Open `chrome://inspect` → Memory tab
4. Load snapshot
5. Look for objects with high "Retained Size"

#### `/dev force-gc`
Forces garbage collection and shows how much memory was freed.

**Useful for:**
- Testing if memory is actually leaked or just not collected
- Seeing what's eligible for GC
- Quick memory cleanup

### 4. Memory Analysis Script
**Location:** `scripts/analyze-memory.sh`

**Commands:**
```bash
# Monitor memory for 1 hour
./scripts/analyze-memory.sh monitor 3600

# Take heap snapshot
./scripts/analyze-memory.sh snapshot

# Show current memory
./scripts/analyze-memory.sh show

# Force GC
./scripts/analyze-memory.sh gc

# Analyze existing log
./scripts/analyze-memory.sh analyze memory-log.csv
```

## 📊 Debugging Workflow

### Step 1: Confirm the Leak (5 minutes)
```bash
# Start monitoring
./scripts/analyze-memory.sh monitor 300

# Check growth rate
# If > 5 MB/min → definite leak
# If 2-5 MB/min → possible leak
# If < 2 MB/min → probably normal
```

### Step 2: Take Baseline Snapshot (1 minute)
```bash
# In Discord
/dev heap-snapshot

# Or via script
./scripts/analyze-memory.sh snapshot
```

### Step 3: Wait and Take Another Snapshot (1-2 hours)
```bash
# Wait 1-2 hours, then take another snapshot
/dev heap-snapshot
```

### Step 4: Compare Snapshots (10 minutes)
```bash
# Download both snapshots
scp server:/tmp/heap-*.heapsnapshot ./

# Open Chrome DevTools
# 1. Go to chrome://inspect
# 2. Memory tab → Load both snapshots
# 3. Switch to "Comparison" view
# 4. Look for:
#    - Objects that appear in snapshot 2 but not 1
#    - Objects with growing counts
#    - Large strings or arrays
#    - Detached event listeners
```

### Step 5: Identify the Source (varies)
**Common patterns to look for:**

1. **Large strings** → Check feed summaries, HTML content
2. **Arrays growing** → Check feedQueue, categoryFrequencies
3. **Closures** → Check broadcastEval contexts
4. **EventEmitters** → Check Discord.js client listeners
5. **Timers** → Check setInterval calls

### Step 6: Apply Fix and Verify (1 hour)
```bash
# Apply fix, restart bot
npm start

# Monitor for 1 hour
./scripts/analyze-memory.sh monitor 3600

# Check if growth rate decreased
```

## 🎯 Quick Fixes to Try First

### Fix 1: Reduce broadcastEval Payload
**File:** `src/jobs/feed-poll-job.ts:804`

```typescript
// Before
itemsToSendWithSummaries: itemsToSend.map(item => ({
    title: item.title,
    link: item.link,
    // ...
    articleSummary: item.articleSummary, // Up to 1500 chars
    commentsSummary: item.commentsSummary, // Up to 1500 chars
}))

// After
itemsToSendWithSummaries: itemsToSend.map(item => ({
    title: item.title?.substring(0, 150),
    link: item.link,
    // ...
    articleSummary: item.articleSummary?.substring(0, 500),
    commentsSummary: item.commentsSummary?.substring(0, 500),
}))
```

### Fix 2: Clear feedQueue Periodically
**File:** `src/jobs/feed-poll-job.ts:220`

```typescript
// Add inside batch processor interval
if (cycleCount % 100 === 0) {
    Logger.info(`[FeedPollJob] Cleaning stale feeds from queue...`);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [feedId, item] of feedQueue) {
        if (item.nextCheck < oneDayAgo) {
            feedQueue.delete(feedId);
            removed++;
        }
    }
    Logger.info(`[FeedPollJob] Removed ${removed} stale feeds from queue`);
}
```

### Fix 3: Reset RSS Parser
**File:** `src/jobs/feed-poll-job.ts:220`

```typescript
// Add inside batch processor interval
if (cycleCount % 50 === 0) {
    Logger.info('[FeedPollJob] Resetting RSS parser...');
    const { resetRSSParser } = await import('../utils/rss-parser.js');
    resetRSSParser();
}
```

### Fix 4: Clear Discord.js Caches
**File:** `src/start-bot.ts:135`

```typescript
// Add after bot.start()
setInterval(() => {
    if (client.isReady()) {
        Logger.info('[Bot] Clearing Discord.js caches...');
        client.guilds.cache.clear();
        client.channels.cache.clear();
        client.users.cache.clear();
    }
}, 30 * 60 * 1000); // Every 30 minutes
```

## 📈 Expected Results

After applying fixes:

**Before:**
- Memory growth: 5-10 MB/min
- Heap size: 500MB → 2GB over 24 hours
- OOM crashes after 48 hours

**After:**
- Memory growth: < 2 MB/min
- Heap size: Stable around 300-500MB
- No OOM crashes

## 🆘 If Nothing Works

If memory still leaks after trying all fixes:

1. **Enable timer tracking:**
   ```typescript
   // In start-manager.ts
   enableTimerTracking();
   ```

2. **Use clinic.js for deep profiling:**
   ```bash
   npm install -g clinic
   clinic doctor -- node --expose-gc dist/start-manager.js
   ```

3. **Check for circular references:**
   ```bash
   # Take heap snapshot and look for:
   # - Objects referencing each other
   # - Closures holding large objects
   # - Event listeners not removed
   ```

4. **Consider reverting the "sequential processing" change:**
   ```bash
   git revert d3f67ae
   ```

## 📚 Additional Resources

- **Full Analysis:** See `MEMORY_LEAK_ANALYSIS.md`
- **Memory Profiler Code:** `src/utils/memory-profiler.ts`
- **Leak Detector Code:** `src/utils/leak-detector.ts`
- **Analysis Script:** `scripts/analyze-memory.sh`

## 🤝 Need Help?

If you're still stuck:
1. Share heap snapshot comparison screenshots
2. Share memory growth rate from monitoring
3. Share logs showing memory usage over time
4. Check PostHog for leak detection events
