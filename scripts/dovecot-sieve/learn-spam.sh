#!/bin/bash
# Called by Sieve imapsieve when a message is moved TO the Junk folder.
# Sends the message to SpamProxy API for spam learning + federation sync.
SPAMPROXY_URL="${SPAMPROXY_URL:-http://SPAMPROXY_HOST:8025}"
exec curl -s -o /dev/null \
    -X POST "${SPAMPROXY_URL}/api/learn/spam" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @- \
    --max-time 30
