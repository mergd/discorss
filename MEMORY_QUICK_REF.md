# 🚀 Memory Leak Debugging - Quick Reference Card

## 🎯 One-Liner Commands

```bash
# Enable profiling and start
ENABLE_MEMORY_PROFILING=true npm start

# Monitor for 1 hour
./scripts/analyze-memory.sh monitor 3600

# Take heap snapshot
/dev heap-snapshot  # (in Discord)

# Force GC
/dev force-gc  # (in Discord)

# Check current memory
/dev memory  # (in Discord)
```

## 📊 What to Look For

### Memory Growth Rate
- **< 2 MB/min** → ✅ Normal
- **2-5 MB/min** → ⚠️ Watch closely
- **> 5 MB/min** → 🚨 Leak detected

### Heap Snapshot Red Flags
- Large strings (>1MB)
- Growing arrays/Maps/Sets
- Detached event listeners
- Retained closures
- High "Retained Size" objects

## 🔧 Quick Fixes (Copy-Paste Ready)

### Fix 1: Reduce Payload (feed-poll-job.ts:804)
```typescript
itemsToSendWithSummaries: itemsToSend.map(item => ({
    title: item.title?.substring(0, 150),
    link: item.link,
    pubDate: item.pubDate,
    isoDate: item.isoDate,
    creator: item.creator,
    author: item.author,
    comments: item.comments,
    articleSummary: item.articleSummary?.substring(0, 500),
    commentsSummary: item.commentsSummary?.substring(0, 500),
    articleReadTime: item.articleReadTime,
}))
```

### Fix 2: Clear Queue (feed-poll-job.ts:220)
```typescript
// Add inside batchProcessorInterval
if (cycleCount % 100 === 0) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [feedId, item] of feedQueue) {
        if (item.nextCheck < oneDayAgo) {
            feedQueue.delete(feedId);
            removed++;
        }
    }
    Logger.info(`[FeedPollJob] Cleaned ${removed} stale feeds`);
}
```

### Fix 3: Reset Parser (feed-poll-job.ts:220)
```typescript
// Add inside batchProcessorInterval
if (cycleCount % 50 === 0) {
    const { resetRSSParser } = await import('../utils/rss-parser.js');
    resetRSSParser();
    Logger.info('[FeedPollJob] Reset RSS parser');
}
```

### Fix 4: Clear Caches (start-bot.ts:135)
```typescript
// Add after bot.start()
setInterval(() => {
    if (client.isReady()) {
        client.guilds.cache.clear();
        client.channels.cache.clear();
        client.users.cache.clear();
        Logger.info('[Bot] Cleared Discord.js caches');
    }
}, 30 * 60 * 1000);
```

## 🔍 Debugging Workflow (30 min)

1. **Start monitoring** (1 min)
   ```bash
   ./scripts/analyze-memory.sh monitor 3600 &
   ```

2. **Take baseline snapshot** (1 min)
   ```
   /dev heap-snapshot
   ```

3. **Wait** (1-2 hours)
   - Let bot run normally
   - Check `/dev memory` periodically

4. **Take comparison snapshot** (1 min)
   ```
   /dev heap-snapshot
   ```

5. **Download snapshots** (2 min)
   ```bash
   scp server:/tmp/heap-*.heapsnapshot ./
   ```

6. **Analyze in Chrome** (10 min)
   - Open `chrome://inspect`
   - Memory tab → Load both snapshots
   - Use "Comparison" view
   - Sort by "Delta" to see what grew

7. **Apply fix** (5 min)
   - Use one of the quick fixes above
   - Restart bot

8. **Verify** (10 min)
   - Monitor for another hour
   - Check if growth rate decreased

## 📈 Expected Timeline

| Action | Time | Result |
|--------|------|--------|
| Enable profiling | 1 min | Automatic monitoring starts |
| First snapshot | 1 min | Baseline captured |
| Wait period | 1-2 hrs | Let leak manifest |
| Second snapshot | 1 min | Comparison data captured |
| Analysis | 10 min | Identify leak source |
| Apply fix | 5 min | Code change |
| Verification | 1 hr | Confirm fix works |
| **Total** | **2-3 hrs** | **Leak identified & fixed** |

## 🎨 Chrome DevTools Cheat Sheet

### Loading Snapshots
1. Open `chrome://inspect`
2. Click "Memory" tab
3. Click "Load" button
4. Select `.heapsnapshot` file

### Comparison View
1. Load both snapshots
2. Select newer snapshot
3. Change dropdown from "Summary" to "Comparison"
4. Select baseline snapshot in second dropdown
5. Sort by "Delta" column (descending)

### What to Look For
- **Strings** → Check for accumulated feed content
- **(array)** → Check for growing collections
- **Map** → Check feedQueue, categoryFrequencies
- **closure** → Check broadcastEval contexts
- **EventEmitter** → Check for listener leaks

### Red Flags
- Objects with "Retained Size" > 10MB
- Objects that appear in snapshot 2 but not 1
- Arrays/Maps with 1000+ elements
- Strings > 1MB

## 🚨 Emergency Commands

### Bot is OOMing Right Now
```bash
# Force GC via Discord
/dev force-gc

# Or via script
./scripts/analyze-memory.sh gc

# Take snapshot before restart
/dev heap-snapshot

# Restart with profiling
ENABLE_MEMORY_PROFILING=true npm restart
```

### Need Immediate Analysis
```bash
# Take snapshot
/dev heap-snapshot

# Show current memory
./scripts/analyze-memory.sh show

# Force GC and see what's freed
./scripts/analyze-memory.sh gc
```

## 📞 Support Checklist

When asking for help, provide:
- [ ] Memory growth rate (MB/min)
- [ ] Heap snapshot comparison screenshots
- [ ] Logs showing memory usage over time
- [ ] Output of `/dev memory`
- [ ] PostHog leak detection events
- [ ] Time since last restart
- [ ] Number of feeds configured

## 🔗 Full Documentation

- **Quick Start:** `README_MEMORY_DEBUGGING.md`
- **Deep Dive:** `MEMORY_LEAK_ANALYSIS.md`
- **Summary:** `MEMORY_DEBUGGING_SUMMARY.md`
- **This Card:** `MEMORY_QUICK_REF.md`

---

**Print this card and keep it handy!** 📄
