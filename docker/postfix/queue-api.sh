#!/bin/bash
# Minimal Queue API for SpamProxy mail-service
# Listens on port 8026, responds to simple HTTP-like commands
# Called by socat from entrypoint.sh

read -r REQUEST
CMD=$(echo "$REQUEST" | tr -d '\r\n')

case "$CMD" in
    "GET /queue")
        # Return queue as JSON (one JSON object per line)
        DATA=$(postqueue -j 2>/dev/null || echo "[]")
        echo "HTTP/1.0 200 OK"
        echo "Content-Type: application/json"
        echo ""
        echo "$DATA"
        ;;
    "POST /flush")
        postqueue -f 2>/dev/null
        echo "HTTP/1.0 200 OK"
        echo ""
        echo '{"status":"ok","action":"flush"}'
        ;;
    POST\ /requeue\ *)
        QUEUE_ID=$(echo "$CMD" | awk '{print $3}')
        postsuper -r "$QUEUE_ID" 2>/dev/null
        echo "HTTP/1.0 200 OK"
        echo ""
        echo "{\"status\":\"ok\",\"action\":\"requeue\",\"id\":\"$QUEUE_ID\"}"
        ;;
    POST\ /delete\ *)
        QUEUE_ID=$(echo "$CMD" | awk '{print $3}')
        postsuper -d "$QUEUE_ID" 2>/dev/null
        echo "HTTP/1.0 200 OK"
        echo ""
        echo "{\"status\":\"ok\",\"action\":\"delete\",\"id\":\"$QUEUE_ID\"}"
        ;;
    POST\ /hold\ *)
        QUEUE_ID=$(echo "$CMD" | awk '{print $3}')
        postsuper -h "$QUEUE_ID" 2>/dev/null
        echo "HTTP/1.0 200 OK"
        echo ""
        echo "{\"status\":\"ok\",\"action\":\"hold\",\"id\":\"$QUEUE_ID\"}"
        ;;
    POST\ /release\ *)
        QUEUE_ID=$(echo "$CMD" | awk '{print $3}')
        postsuper -H "$QUEUE_ID" 2>/dev/null
        echo "HTTP/1.0 200 OK"
        echo ""
        echo "{\"status\":\"ok\",\"action\":\"release\",\"id\":\"$QUEUE_ID\"}"
        ;;
    *)
        echo "HTTP/1.0 400 Bad Request"
        echo ""
        echo '{"error":"unknown command"}'
        ;;
esac
