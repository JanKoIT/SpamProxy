#!/bin/sh
# rspamd entrypoint - merges keypairs into worker-normal config

KEYPAIRS_FILE="/etc/rspamd/keypairs/scanner-keypairs.conf"
WORKER_OVERRIDE="/etc/rspamd/override.d/worker-normal.inc"

# If keypairs exist, create an override file that includes them
if [ -f "$KEYPAIRS_FILE" ] && [ -s "$KEYPAIRS_FILE" ]; then
    echo "Loading scanner client keypairs from $KEYPAIRS_FILE"
    cp "$KEYPAIRS_FILE" "$WORKER_OVERRIDE"
else
    # Ensure no stale override
    rm -f "$WORKER_OVERRIDE" 2>/dev/null
fi

# Start socat keypair API in background
socat TCP-LISTEN:11336,reuseaddr,fork EXEC:/keypair-api.sh &

# Start rspamd
exec /usr/bin/rspamd -f "$@"
