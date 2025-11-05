# 🎯 Memory Leak Debugging - Implementation Summary

## ✅ What Was Done

### 1. **Comprehensive Memory Profiling System**
Created `src/utils/memory-profiler.ts` with:
- ✅ Automatic memory snapshots every 30 seconds
- ✅ Leak detection algorithm (detects >5MB/min growth)
- ✅ Peak memory tracking
- ✅ Heap snapshot generation (Chrome DevTools compatible)
- ✅ PostHog integration for alerts
- ✅ Memory growth rate calculation
- ✅ Export functionality for analysis

### 2. **Leak Detection System**
Created `src/utils/leak-detector.ts` with:
- ✅ EventEmitter listener leak detection
- ✅ Timer leak detection (setInterval/setTimeout)
- ✅ Global variable leak detection
- ✅ Active handle/request monitoring
- ✅ Timer tracking (monkey-patches setInterval/setTimeout)

### 3. **Developer Commands**
Enhanced `/dev` command with 3 new subcommands:
- ✅ `/dev memory` - View real-time memory stats and leak status
- ✅ `/dev heap-snapshot` - Generate heap snapshot for analysis
- ✅ `/dev force-gc` - Force garbage collection and see freed memory

### 4. **Automated Monitoring**
Integrated into `start-manager.ts`:
- ✅ Auto-starts profiler when `ENABLE_MEMORY_PROFILING=true`
- ✅ Auto-starts leak detector
- ✅ Periodic memory reports every 10 minutes
- ✅ Graceful shutdown with final memory report export
- ✅ Timer tracking in development mode

### 5. **Analysis Tools**
Created `scripts/analyze-memory.sh`:
- ✅ Monitor memory over time with CSV export
- ✅ Take heap snapshots
- ✅ Force garbage collection
- ✅ Analyze memory logs with statistics
- ✅ Detect memory growth rates
- ✅ Compare snapshots

### 6. **Documentation**
Created 3 comprehensive guides:
- ✅ `MEMORY_LEAK_ANALYSIS.md` - Deep dive into potential leaks
- ✅ `README_MEMORY_DEBUGGING.md` - Quick start guide
- ✅ `MEMORY_DEBUGGING_SUMMARY.md` - This file

## 🔍 Key Findings

### Timeline Analysis
**Regression started:** September 16, 2025

**Suspicious commits:**
- `d3f67ae` - "Process feed summaries sequentially to lower memory"
- `6cdeaf0` - "feat: lower memory usage"
- `71a2c90` - Merge PR #6 to decrease memory usage

**Paradox:** Memory "optimizations" may have introduced new leaks.

### Top 3 Likely Culprits

#### 1. **broadcastEval Payload Size** (feed-poll-job.ts:590-824)
**Problem:** Each feed item sends up to 3KB to every shard
**Impact:** 100 feeds × 5 items × 3 shards = 1.5MB per batch
**Location:** `src/jobs/feed-poll-job.ts:804`

#### 2. **feedQueue Map** (feed-poll-job.ts:57)
**Problem:** Never fully cleared, accumulates deleted feeds
**Impact:** Grows unbounded over time
**Location:** `src/jobs/feed-poll-job.ts:57`

#### 3. **RSS Parser State** (rss-parser.ts:4)
**Problem:** Shared singleton never reset
**Impact:** Internal state accumulation
**Location:** `src/utils/rss-parser.ts:4`

## 🚀 How to Use

### Quick Start
```bash
# 1. Enable profiling
ENABLE_MEMORY_PROFILING=true npm start

# 2. Check memory in Discord
/dev memory

# 3. Take heap snapshot
/dev heap-snapshot

# 4. Monitor for 1 hour
./scripts/analyze-memory.sh monitor 3600
```

### Debugging Workflow
1. **Confirm leak** (5 min): Monitor memory growth rate
2. **Take baseline** (1 min): Capture initial heap snapshot
3. **Wait** (1-2 hours): Let bot run under normal load
4. **Take comparison** (1 min): Capture second heap snapshot
5. **Analyze** (10 min): Compare snapshots in Chrome DevTools
6. **Fix** (varies): Apply targeted fixes
7. **Verify** (1 hour): Monitor to confirm fix

### Expected Results

**Before fixes:**
- Memory growth: 5-10 MB/min
- Heap size: 500MB → 2GB over 24 hours
- OOM crashes after 48 hours

**After fixes:**
- Memory growth: < 2 MB/min
- Heap size: Stable around 300-500MB
- No OOM crashes

## 📋 Recommended Fixes

### Priority 1: Reduce broadcastEval Payload
```typescript
// File: src/jobs/feed-poll-job.ts:804
itemsToSendWithSummaries: itemsToSend.map(item => ({
    title: item.title?.substring(0, 150),  // Truncate
    articleSummary: item.articleSummary?.substring(0, 500),  // Was 1500
    commentsSummary: item.commentsSummary?.substring(0, 500),
    // ... other fields
}))
```

### Priority 2: Clear feedQueue Periodically
```typescript
// File: src/jobs/feed-poll-job.ts:220 (inside batch processor)
if (cycleCount % 100 === 0) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [feedId, item] of feedQueue) {
        if (item.nextCheck < oneDayAgo) {
            feedQueue.delete(feedId);
        }
    }
}
```

### Priority 3: Reset RSS Parser
```typescript
// File: src/jobs/feed-poll-job.ts:220 (inside batch processor)
if (cycleCount % 50 === 0) {
    const { resetRSSParser } = await import('../utils/rss-parser.js');
    resetRSSParser();
}
```

### Priority 4: Clear Discord.js Caches
```typescript
// File: src/start-bot.ts:135 (after bot.start())
setInterval(() => {
    if (client.isReady()) {
        client.guilds.cache.clear();
        client.channels.cache.clear();
        client.users.cache.clear();
    }
}, 30 * 60 * 1000);
```

## 📊 Monitoring Checklist

- [ ] Enable memory profiling in production
- [ ] Set up PostHog alerts for leak detection
- [ ] Take heap snapshots at: startup, 1hr, 6hr, 24hr
- [ ] Monitor logs for memory growth patterns
- [ ] Check `/dev memory` daily for leak status
- [ ] Review memory reports every 10 minutes (in logs)
- [ ] Export and analyze memory snapshots on shutdown

## 🆘 If Memory Still Leaks

1. **Enable timer tracking** to find unclosed intervals
2. **Use clinic.js** for deeper profiling:
   ```bash
   npm install -g clinic
   clinic doctor -- node --expose-gc dist/start-manager.js
   ```
3. **Check for circular references** in heap snapshots
4. **Review broadcastEval closures** for captured large objects
5. **Consider reverting** commit d3f67ae (sequential processing)

## 📁 Files Created/Modified

### New Files
- `src/utils/memory-profiler.ts` - Memory profiling system
- `src/utils/leak-detector.ts` - Leak detection system
- `scripts/analyze-memory.sh` - Analysis script
- `MEMORY_LEAK_ANALYSIS.md` - Detailed analysis
- `README_MEMORY_DEBUGGING.md` - Quick start guide
- `MEMORY_DEBUGGING_SUMMARY.md` - This file

### Modified Files
- `src/utils/index.ts` - Export new utilities
- `src/start-manager.ts` - Integrate profiling
- `src/commands/chat/dev-command.ts` - Add memory commands
- `src/commands/args.ts` - Add command options
- `src/enums/dev-command-name.ts` - Add command enums

## 🎓 Key Learnings

1. **Memory optimizations can introduce leaks** - The September 16 changes to "lower memory" may have created new leak patterns
2. **broadcastEval is expensive** - Sending large contexts to multiple shards multiplies memory usage
3. **Shared singletons need periodic reset** - RSS parser and other singletons accumulate state
4. **Maps/Sets need bounds** - Unbounded collections like feedQueue will grow forever
5. **Discord.js caches need management** - Even with cache limits, periodic clearing helps

## 🔗 Resources

- **Node.js Profiling:** https://nodejs.org/en/docs/guides/simple-profiling/
- **Chrome DevTools:** https://developer.chrome.com/docs/devtools/memory-problems/
- **Discord.js Optimization:** https://discordjs.guide/popular-topics/common-questions.html

## ✨ Next Steps

1. **Deploy with profiling enabled** and monitor for 24 hours
2. **Take baseline heap snapshot** immediately after deployment
3. **Apply Priority 1-3 fixes** if leak is confirmed
4. **Monitor PostHog** for automatic leak detection alerts
5. **Review logs** for memory growth patterns
6. **Take comparison snapshot** after 24 hours
7. **Analyze and iterate** based on findings

---

**Status:** ✅ All debugging tools implemented and ready to use
**Estimated time to identify leak:** 2-4 hours with these tools
**Estimated time to fix:** Varies, but likely 1-2 hours once identified
