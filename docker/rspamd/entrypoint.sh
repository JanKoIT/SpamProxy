#!/bin/bash
# rspamd entrypoint with in-container watchdog.
#
# Problem: rspamd's milter worker occasionally stops responding to
# OPTNEG handshakes while the TCP port stays open. Docker healthchecks
# + autoheal take 60-90s to react. This watchdog kills rspamd within
# ~30s of detecting a stuck worker, so Docker's restart policy can
# bring it back fast.

set -e

KEYPAIRS_FILE="/etc/rspamd/keypairs/scanner-keypairs.conf"
WORKER_OVERRIDE="/etc/rspamd/override.d/worker-normal.inc"

if [ -f "$KEYPAIRS_FILE" ] && [ -s "$KEYPAIRS_FILE" ]; then
    echo "Loading scanner client keypairs from $KEYPAIRS_FILE"
    cp "$KEYPAIRS_FILE" "$WORKER_OVERRIDE"
    chown _rspamd:_rspamd "$WORKER_OVERRIDE"
else
    rm -f "$WORKER_OVERRIDE" 2>/dev/null || true
fi

chown -R _rspamd:_rspamd /var/lib/rspamd /run/rspamd 2>/dev/null || true

# Background: keypair API
socat TCP-LISTEN:11336,reuseaddr,fork EXEC:/keypair-api.sh &

# Start rspamd in background, track its PID
/usr/bin/rspamd -f -u _rspamd -g _rspamd "$@" &
RSPAMD_PID=$!

# Forward signals to rspamd on shutdown
trap "kill -TERM $RSPAMD_PID 2>/dev/null; wait $RSPAMD_PID; exit 0" TERM INT

# Watchdog: probe milter OPTNEG every 15s after a 60s warmup grace period.
# Two consecutive failures => kill rspamd so Docker restarts the container.
(
    sleep 60  # warmup
    fails=0
    while true; do
        if /milter-healthcheck.py; then
            if [ "$fails" -gt 0 ]; then
                echo "[watchdog] milter recovered"
            fi
            fails=0
        else
            fails=$((fails + 1))
            echo "[watchdog] milter handshake failed ($fails/2)"
            if [ "$fails" -ge 2 ]; then
                echo "[watchdog] killing rspamd PID $RSPAMD_PID - Docker will restart container"
                kill -KILL "$RSPAMD_PID" 2>/dev/null || true
                exit 1
            fi
        fi
        sleep 15
    done
) &
WATCHDOG_PID=$!

# Wait on rspamd - exit code propagates to Docker
wait "$RSPAMD_PID"
EXIT_CODE=$?
kill "$WATCHDOG_PID" 2>/dev/null || true
exit "$EXIT_CODE"
