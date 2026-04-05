#!/bin/bash
# Mini API for keypair generation - called by socat
read -r REQUEST
CMD=$(echo "$REQUEST" | sed 's/ HTTP\/[0-9.]*//g' | tr -d '\r\n')
while read -r HEADER; do
    HEADER=$(echo "$HEADER" | tr -d '\r\n')
    [ -z "$HEADER" ] && break
done

case "$CMD" in
    "POST /keypair"|"GET /keypair")
        DATA=$(rspamadm keypair 2>/dev/null)
        echo "HTTP/1.0 200 OK"
        echo "Content-Type: text/plain"
        echo "Connection: close"
        echo ""
        echo "$DATA"
        ;;
    *)
        echo "HTTP/1.0 404 Not Found"
        echo "Connection: close"
        echo ""
        ;;
esac
