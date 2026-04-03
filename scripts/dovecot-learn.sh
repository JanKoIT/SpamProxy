#!/bin/bash
set -euo pipefail

# SpamProxy Dovecot Junk Learner
# ================================
# Scans Dovecot mailboxes for Junk/Spam folders and trains rspamd via SpamProxy API.
# Also learns Ham from Inbox (messages moved out of Junk).
#
# Usage:
#   ./scripts/dovecot-learn.sh [OPTIONS]
#
# Options:
#   --url URL         SpamProxy API URL (default: http://localhost:8025)
#   --mail-dir DIR    Dovecot mail root (default: /var/vmail)
#   --format FORMAT   Maildir or mdbox (default: maildir)
#   --junk-folders    Comma-separated junk folder names (default: Junk,Spam,.Junk,.Spam)
#   --ham-folders     Comma-separated ham folder names (default: cur)
#   --learn-ham       Also learn ham from Inbox (default: false)
#   --max-age DAYS    Only process mails newer than N days (default: 7)
#   --max-msgs N      Max messages per folder (default: 200)
#   --dry-run         Show what would be done without sending
#   --state-dir DIR   Where to store processed message IDs (default: /var/lib/spamproxy/learn-state)
#
# Cron example (every 2 hours):
#   0 */2 * * * /opt/spamproxy/scripts/dovecot-learn.sh --url http://spamproxy:8025 >> /var/log/spamproxy-learn.log 2>&1

SPAMPROXY_URL="${SPAMPROXY_URL:-http://localhost:8025}"
MAIL_DIR="/var/vmail"
MAIL_FORMAT="maildir"
JUNK_FOLDERS="Junk,Spam,.Junk,.Spam,INBOX.Junk,INBOX.Spam"
HAM_FOLDERS=""
LEARN_HAM=false
MAX_AGE=7
MAX_MSGS=200
DRY_RUN=false
STATE_DIR="/var/lib/spamproxy/learn-state"
RSPAMD_PASSWORD=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --url)        SPAMPROXY_URL="$2"; shift 2 ;;
        --mail-dir)   MAIL_DIR="$2"; shift 2 ;;
        --format)     MAIL_FORMAT="$2"; shift 2 ;;
        --junk-folders) JUNK_FOLDERS="$2"; shift 2 ;;
        --ham-folders)  HAM_FOLDERS="$2"; shift 2 ;;
        --learn-ham)  LEARN_HAM=true; shift ;;
        --max-age)    MAX_AGE="$2"; shift 2 ;;
        --max-msgs)   MAX_MSGS="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --state-dir)  STATE_DIR="$2"; shift 2 ;;
        --password)   RSPAMD_PASSWORD="$2"; shift 2 ;;
        -h|--help)
            head -28 "$0" | tail -26
            exit 0 ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1 ;;
    esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "$(date '+%H:%M:%S') ${GREEN}[learn]${NC} $1"; }
warn() { echo -e "$(date '+%H:%M:%S') ${YELLOW}[learn]${NC} $1"; }
err()  { echo -e "$(date '+%H:%M:%S') ${RED}[learn]${NC} $1"; }

mkdir -p "$STATE_DIR"

SPAM_LEARNED=0
HAM_LEARNED=0
SKIPPED=0
ERRORS=0

# Check if message was already processed
is_processed() {
    local hash="$1"
    local type="$2"
    [ -f "$STATE_DIR/${type}_${hash}" ]
}

mark_processed() {
    local hash="$1"
    local type="$2"
    touch "$STATE_DIR/${type}_${hash}"
}

# Learn a single message via rspamd controller API
learn_message() {
    local file="$1"
    local type="$2"  # spam or ham

    # Hash filename for dedup
    local hash
    hash=$(echo "$file" | md5sum | cut -d' ' -f1)

    if is_processed "$hash" "$type"; then
        SKIPPED=$((SKIPPED + 1))
        return 0
    fi

    if [ "$DRY_RUN" = true ]; then
        log "[DRY-RUN] Would learn $type: $file"
        return 0
    fi

    # Send raw email to SpamProxy learn endpoint
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "${SPAMPROXY_URL}/api/learn/${type}" \
        --data-binary "@${file}" \
        -H "Content-Type: application/octet-stream" \
        --max-time 30 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        mark_processed "$hash" "$type"
        if [ "$type" = "spam" ]; then
            SPAM_LEARNED=$((SPAM_LEARNED + 1))
        else
            HAM_LEARNED=$((HAM_LEARNED + 1))
        fi
        return 0
    else
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

# Process a maildir folder
process_maildir_folder() {
    local folder="$1"
    local type="$2"
    local count=0

    # Maildir has cur/ and new/ subdirectories
    for subdir in cur new; do
        local dir="${folder}/${subdir}"
        [ -d "$dir" ] || continue

        find "$dir" -type f -mtime "-${MAX_AGE}" 2>/dev/null | head -n "$MAX_MSGS" | while read -r file; do
            learn_message "$file" "$type" || true
            count=$((count + 1))
        done
    done
}

# Find and process junk/spam folders
process_junk_folders() {
    local IFS=','
    for junk_name in $JUNK_FOLDERS; do
        # Search for this folder name in all user mailboxes
        find "$MAIL_DIR" -type d -name "$junk_name" 2>/dev/null | while read -r folder; do
            if [ -d "${folder}/cur" ] || [ -d "${folder}/new" ]; then
                log "Learning spam from: $folder"
                process_maildir_folder "$folder" "spam"
            fi
        done

        # Also check Maildir++ format (.Junk, .Spam under INBOX)
        find "$MAIL_DIR" -type d -name ".${junk_name}" 2>/dev/null | while read -r folder; do
            if [ -d "${folder}/cur" ] || [ -d "${folder}/new" ]; then
                log "Learning spam from: $folder"
                process_maildir_folder "$folder" "spam"
            fi
        done
    done
}

# Find and process inbox for ham learning
process_ham_folders() {
    if [ "$LEARN_HAM" != true ]; then
        return
    fi

    # Learn from INBOX/cur (messages user kept = ham)
    find "$MAIL_DIR" -type d -name "cur" -path "*/Maildir/cur" 2>/dev/null | while read -r folder; do
        # Skip junk folders
        local parent
        parent=$(dirname "$folder")
        local skip=false
        local IFS=','
        for junk_name in $JUNK_FOLDERS; do
            if echo "$parent" | grep -qi "$junk_name"; then
                skip=true
                break
            fi
        done
        if [ "$skip" = true ]; then continue; fi

        log "Learning ham from: $folder"
        find "$folder" -type f -mtime "-${MAX_AGE}" 2>/dev/null | head -n "$MAX_MSGS" | while read -r file; do
            learn_message "$file" "ham" || true
        done
    done
}

# Cleanup old state files (older than 90 days)
cleanup_state() {
    find "$STATE_DIR" -type f -mtime +90 -delete 2>/dev/null || true
}

# ─── Main ────────────────────────────────────────────────────
log "=== Dovecot Junk Learner ==="
log "Mail dir: $MAIL_DIR"
log "Junk folders: $JUNK_FOLDERS"
log "Max age: ${MAX_AGE} days, Max msgs: ${MAX_MSGS}"
log "SpamProxy: $SPAMPROXY_URL"
[ "$DRY_RUN" = true ] && warn "DRY RUN - no actual learning"
[ "$LEARN_HAM" = true ] && log "Ham learning: enabled"

if [ ! -d "$MAIL_DIR" ]; then
    err "Mail directory not found: $MAIL_DIR"
    err "Set --mail-dir to your Dovecot virtual mail root"
    exit 1
fi

process_junk_folders
process_ham_folders
cleanup_state

log ""
log "=== Results ==="
log "Spam learned: $SPAM_LEARNED"
log "Ham learned:  $HAM_LEARNED"
log "Skipped:      $SKIPPED (already processed)"
log "Errors:       $ERRORS"
