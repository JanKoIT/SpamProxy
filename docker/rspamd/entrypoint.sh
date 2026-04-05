#!/bin/sh
# rspamd entrypoint - merges keypairs into worker-normal config

KEYPAIRS_FILE="/etc/rspamd/keypairs/scanner-keypairs.conf"
WORKER_OVERRIDE="/etc/rspamd/override.d/worker-normal.inc"

# Copy keypairs to override.d (runs as root)
if [ -f "$KEYPAIRS_FILE" ] && [ -s "$KEYPAIRS_FILE" ]; then
    echo "Loading scanner client keypairs from $KEYPAIRS_FILE"
    cp "$KEYPAIRS_FILE" "$WORKER_OVERRIDE"
    chown _rspamd:_rspamd "$WORKER_OVERRIDE"
    echo "Keypairs loaded into $WORKER_OVERRIDE"
else
    rm -f "$WORKER_OVERRIDE" 2>/dev/null
    echo "No scanner client keypairs found"
fi

# Fix ownership for rspamd runtime dirs
chown -R _rspamd:_rspamd /var/lib/rspamd /run/rspamd 2>/dev/null || true

# Start socat keypair API in background
socat TCP-LISTEN:11336,reuseaddr,fork EXEC:/keypair-api.sh &

# Start rspamd (it drops privileges to _rspamd internally)
exec /usr/bin/rspamd -f -u _rspamd -g _rspamd "$@"
