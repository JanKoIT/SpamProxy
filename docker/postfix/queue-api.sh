#!/bin/bash
# Minimal Queue API for SpamProxy mail-service
# Listens on port 8026, responds to HTTP requests
# Called by socat from entrypoint.sh

# Read first line (HTTP request line)
read -r REQUEST
# Strip HTTP version and whitespace: "GET /queue HTTP/1.1" -> "GET /queue"
CMD=$(echo "$REQUEST" | sed 's/ HTTP\/[0-9.]*//g' | tr -d '\r\n')

# Consume remaining headers (until empty line)
while read -r HEADER; do
    HEADER=$(echo "$HEADER" | tr -d '\r\n')
    [ -z "$HEADER" ] && break
done

# Extract method and path
METHOD=$(echo "$CMD" | awk '{print $1}')
PATH_RAW=$(echo "$CMD" | awk '{print $2}')

# Parse action and queue_id from path: /action/QUEUEID
ACTION=$(echo "$PATH_RAW" | cut -d/ -f2)
QUEUE_ID=$(echo "$PATH_RAW" | cut -d/ -f3)

ok_response() {
    echo "HTTP/1.0 200 OK"
    echo "Content-Type: application/json"
    echo "Connection: close"
    echo ""
}

case "$METHOD $ACTION" in
    "GET queue")
        DATA=$(postqueue -j 2>/dev/null || echo "")
        ok_response
        if [ -z "$DATA" ]; then
            echo "[]"
        else
            echo "$DATA"
        fi
        ;;
    "POST flush")
        postqueue -f 2>/dev/null
        ok_response
        echo '{"status":"ok","action":"flush"}'
        ;;
    "POST requeue")
        postsuper -r "$QUEUE_ID" 2>/dev/null
        ok_response
        echo "{\"status\":\"ok\",\"action\":\"requeue\",\"id\":\"$QUEUE_ID\"}"
        ;;
    "POST delete")
        postsuper -d "$QUEUE_ID" 2>/dev/null
        ok_response
        echo "{\"status\":\"ok\",\"action\":\"delete\",\"id\":\"$QUEUE_ID\"}"
        ;;
    "POST hold")
        postsuper -h "$QUEUE_ID" 2>/dev/null
        ok_response
        echo "{\"status\":\"ok\",\"action\":\"hold\",\"id\":\"$QUEUE_ID\"}"
        ;;
    "POST release")
        postsuper -H "$QUEUE_ID" 2>/dev/null
        ok_response
        echo "{\"status\":\"ok\",\"action\":\"release\",\"id\":\"$QUEUE_ID\"}"
        ;;
    *)
        echo "HTTP/1.0 400 Bad Request"
        echo "Content-Type: application/json"
        echo "Connection: close"
        echo ""
        echo "{\"error\":\"unknown: $METHOD $ACTION\"}"
        ;;
esac
