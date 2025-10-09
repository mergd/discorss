#!/bin/bash
# Script to monitor Docker container memory usage

CONTAINER_NAME="discordss-public-bot-1"

echo "Monitoring memory usage for container: $CONTAINER_NAME"
echo "Press Ctrl+C to stop"
echo ""
echo "Time                Memory Usage    Memory Limit    Percentage"
echo "================================================================"

while true; do
    # Get memory stats
    STATS=$(docker stats --no-stream --format "{{.MemUsage}}\t{{.MemPerc}}" $CONTAINER_NAME 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
        echo "$TIMESTAMP    $STATS"
    else
        echo "Container not running or not found"
        break
    fi
    
    sleep 10
done

