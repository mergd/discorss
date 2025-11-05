#!/bin/bash
# Memory Analysis Helper Script
# This script helps analyze memory usage and detect leaks in the Discorss bot

set -e

CONTAINER_NAME="${CONTAINER_NAME:-discordss-public-bot-1}"
OUTPUT_DIR="${OUTPUT_DIR:-./memory-analysis}"
DURATION="${DURATION:-3600}" # 1 hour default

echo "🔍 Discorss Memory Analysis Tool"
echo "================================"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Function to get memory stats
get_memory_stats() {
    if command -v docker &> /dev/null && docker ps | grep -q "$CONTAINER_NAME"; then
        docker stats --no-stream --format "{{.MemUsage}}" "$CONTAINER_NAME" 2>/dev/null
    else
        ps aux | grep "node.*start-manager" | grep -v grep | awk '{print $6 " KB"}'
    fi
}

# Function to take heap snapshot
take_heap_snapshot() {
    echo "📸 Taking heap snapshot..."
    if command -v docker &> /dev/null && docker ps | grep -q "$CONTAINER_NAME"; then
        docker exec "$CONTAINER_NAME" node -e "
            const v8 = require('v8');
            const filename = '/tmp/heap-' + Date.now() + '.heapsnapshot';
            v8.writeHeapSnapshot(filename);
            console.log('Snapshot saved to ' + filename);
        " 2>/dev/null || echo "❌ Failed to take snapshot (node may not have --expose-gc flag)"
    else
        echo "❌ Container not found. Please ensure the bot is running."
    fi
}

# Function to monitor memory over time
monitor_memory() {
    local duration=$1
    local interval=30
    local output_file="$OUTPUT_DIR/memory-log-$(date +%Y%m%d-%H%M%S).csv"
    
    echo "📊 Monitoring memory for $duration seconds (interval: ${interval}s)"
    echo "Output: $output_file"
    echo ""
    echo "timestamp,memory_mb,rss_mb,heap_used_mb,heap_total_mb" > "$output_file"
    
    local end_time=$(($(date +%s) + duration))
    
    while [ $(date +%s) -lt $end_time ]; do
        local timestamp=$(date +%Y-%m-%d\ %H:%M:%S)
        local memory=$(get_memory_stats)
        
        # Try to get detailed stats from container
        if command -v docker &> /dev/null && docker ps | grep -q "$CONTAINER_NAME"; then
            docker exec "$CONTAINER_NAME" node -e "
                const mem = process.memoryUsage();
                console.log([
                    '$timestamp',
                    (mem.rss / 1024 / 1024).toFixed(2),
                    (mem.rss / 1024 / 1024).toFixed(2),
                    (mem.heapUsed / 1024 / 1024).toFixed(2),
                    (mem.heapTotal / 1024 / 1024).toFixed(2)
                ].join(','));
            " 2>/dev/null >> "$output_file" || echo "$timestamp,$memory,,,," >> "$output_file"
        else
            echo "$timestamp,$memory,,,," >> "$output_file"
        fi
        
        echo "[$timestamp] Memory: $memory"
        sleep $interval
    done
    
    echo ""
    echo "✅ Monitoring complete. Data saved to $output_file"
    
    # Analyze the data
    analyze_memory_log "$output_file"
}

# Function to analyze memory log
analyze_memory_log() {
    local log_file=$1
    
    echo ""
    echo "📈 Memory Analysis Results"
    echo "=========================="
    
    # Skip header and calculate stats
    tail -n +2 "$log_file" | awk -F',' '
    BEGIN {
        count = 0
        sum = 0
        min = 999999
        max = 0
        first = 0
        last = 0
    }
    {
        if ($2 != "") {
            count++
            sum += $2
            if ($2 < min) min = $2
            if ($2 > max) max = $2
            if (first == 0) first = $2
            last = $2
        }
    }
    END {
        if (count > 0) {
            avg = sum / count
            growth = last - first
            growth_rate = (count > 1) ? (growth / (count * 30 / 60)) : 0  # MB per minute
            
            print "Samples:      " count
            print "Average:      " sprintf("%.2f MB", avg)
            print "Min:          " sprintf("%.2f MB", min)
            print "Max:          " sprintf("%.2f MB", max)
            print "Growth:       " sprintf("%.2f MB", growth)
            print "Growth Rate:  " sprintf("%.2f MB/min", growth_rate)
            print ""
            
            if (growth_rate > 5) {
                print "⚠️  WARNING: High memory growth rate detected!"
                print "   This indicates a potential memory leak."
            } else if (growth_rate > 2) {
                print "⚡ CAUTION: Moderate memory growth detected."
                print "   Monitor closely for continued growth."
            } else {
                print "✅ Memory usage appears stable."
            }
        }
    }
    '
}

# Function to compare heap snapshots
compare_snapshots() {
    echo "📊 Heap Snapshot Comparison"
    echo "============================"
    echo ""
    echo "To compare heap snapshots:"
    echo "1. Take a snapshot now"
    echo "2. Wait 1-2 hours"
    echo "3. Take another snapshot"
    echo "4. Download both snapshots from /tmp/"
    echo "5. Open Chrome DevTools (chrome://inspect)"
    echo "6. Load both snapshots in Memory tab"
    echo "7. Use 'Comparison' view to see what grew"
    echo ""
    
    take_heap_snapshot
}

# Function to force garbage collection
force_gc() {
    echo "🗑️  Forcing garbage collection..."
    if command -v docker &> /dev/null && docker ps | grep -q "$CONTAINER_NAME"; then
        docker exec "$CONTAINER_NAME" node --expose-gc -e "
            const before = process.memoryUsage();
            console.log('Before GC: ' + (before.heapUsed / 1024 / 1024).toFixed(2) + ' MB');
            global.gc();
            const after = process.memoryUsage();
            console.log('After GC:  ' + (after.heapUsed / 1024 / 1024).toFixed(2) + ' MB');
            console.log('Freed:     ' + ((before.heapUsed - after.heapUsed) / 1024 / 1024).toFixed(2) + ' MB');
        " 2>/dev/null || echo "❌ GC not available (start with --expose-gc flag)"
    else
        echo "❌ Container not found"
    fi
}

# Function to show current memory
show_memory() {
    echo "💾 Current Memory Usage"
    echo "======================="
    
    if command -v docker &> /dev/null && docker ps | grep -q "$CONTAINER_NAME"; then
        docker exec "$CONTAINER_NAME" node -e "
            const mem = process.memoryUsage();
            console.log('RSS:          ' + (mem.rss / 1024 / 1024).toFixed(2) + ' MB');
            console.log('Heap Total:   ' + (mem.heapTotal / 1024 / 1024).toFixed(2) + ' MB');
            console.log('Heap Used:    ' + (mem.heapUsed / 1024 / 1024).toFixed(2) + ' MB');
            console.log('External:     ' + (mem.external / 1024 / 1024).toFixed(2) + ' MB');
            console.log('Array Buffers:' + (mem.arrayBuffers / 1024 / 1024).toFixed(2) + ' MB');
        " 2>/dev/null
    else
        echo "Memory: $(get_memory_stats)"
    fi
}

# Main menu
case "${1:-menu}" in
    monitor)
        monitor_memory "$DURATION"
        ;;
    snapshot)
        take_heap_snapshot
        ;;
    compare)
        compare_snapshots
        ;;
    gc)
        force_gc
        ;;
    show)
        show_memory
        ;;
    analyze)
        if [ -z "$2" ]; then
            echo "Usage: $0 analyze <log-file.csv>"
            exit 1
        fi
        analyze_memory_log "$2"
        ;;
    menu|*)
        echo "Usage: $0 <command> [options]"
        echo ""
        echo "Commands:"
        echo "  monitor [duration]  - Monitor memory usage over time (default: 1 hour)"
        echo "  snapshot           - Take a heap snapshot"
        echo "  compare            - Take snapshots for comparison"
        echo "  gc                 - Force garbage collection"
        echo "  show               - Show current memory usage"
        echo "  analyze <file>     - Analyze a memory log file"
        echo ""
        echo "Environment Variables:"
        echo "  CONTAINER_NAME     - Docker container name (default: discordss-public-bot-1)"
        echo "  OUTPUT_DIR         - Output directory (default: ./memory-analysis)"
        echo "  DURATION           - Monitoring duration in seconds (default: 3600)"
        echo ""
        echo "Examples:"
        echo "  $0 monitor 7200              # Monitor for 2 hours"
        echo "  $0 snapshot                  # Take heap snapshot"
        echo "  DURATION=600 $0 monitor      # Monitor for 10 minutes"
        ;;
esac
