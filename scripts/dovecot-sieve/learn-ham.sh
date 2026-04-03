#!/bin/bash
# Called by Sieve imapsieve when a message is moved FROM the Junk folder.
# Learns the message as ham via rspamd.

RSPAMD_URL="${RSPAMD_URL:-http://localhost:11334}"
RSPAMD_PASSWORD="${RSPAMD_PASSWORD:-}"

HEADERS=""
[ -n "$RSPAMD_PASSWORD" ] && HEADERS="-H Password:${RSPAMD_PASSWORD}"

exec curl -s -o /dev/null \
    -X POST "${RSPAMD_URL}/learnham" \
    --data-binary @- \
    $HEADERS \
    --max-time 30
