#!/bin/bash
# Host OS update status probe.
#
# Runs on the host (not inside a container), refreshes the apt index,
# counts pending updates, checks for reboot requirement, and writes a
# JSON summary to /var/lib/spamproxy/host-updates.json. That file is
# mounted read-only into mail-service, which surfaces it in the
# system-status UI.

set -euo pipefail

STATE_DIR="/var/lib/spamproxy"
STATE_FILE="$STATE_DIR/host-updates.json"

mkdir -p "$STATE_DIR"

# Refresh package lists (silent)
apt-get update -qq >/dev/null 2>&1 || true

# Count upgradable packages. "apt list --upgradable" prints a header
# line ("Listing..."), so subtract 1 - or zero if only that header.
TOTAL=$(apt list --upgradable 2>/dev/null | tail -n +2 | grep -c . || true)
[ -z "$TOTAL" ] && TOTAL=0

# Security updates: match origin from Debian/Ubuntu security repos.
SECURITY=$(apt list --upgradable 2>/dev/null \
    | grep -Ei '(-security|security\.debian|security\.ubuntu)' \
    | wc -l || true)
[ -z "$SECURITY" ] && SECURITY=0

# Reboot required (Debian/Ubuntu convention)
REBOOT=false
if [ -f /var/run/reboot-required ]; then
    REBOOT=true
fi

# Kernel version (for context)
KERNEL=$(uname -r)

# Distro info
if [ -r /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    DISTRO="${PRETTY_NAME:-$NAME}"
else
    DISTRO="unknown"
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$STATE_FILE.tmp" <<EOF
{
  "checked_at": "$TIMESTAMP",
  "distro": "$DISTRO",
  "kernel": "$KERNEL",
  "total_updates": $TOTAL,
  "security_updates": $SECURITY,
  "reboot_required": $REBOOT
}
EOF
mv "$STATE_FILE.tmp" "$STATE_FILE"
chmod 644 "$STATE_FILE"
