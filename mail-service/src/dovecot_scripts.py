"""Generate customized Dovecot integration scripts."""


def generate_learn_script(
    proxy_host: str,
    users_file: str = "/etc/dovecot/users",
    junk_folders: str = "Junk,Spam,.Junk,.Spam,INBOX.Junk,INBOX.Spam",
    max_age: int = 7,
    learn_ham: bool = True,
) -> str:
    api_url = f"http://{proxy_host}:8025"
    return f'''#!/bin/bash
set -euo pipefail
# SpamProxy Dovecot Junk Learner
# Generated for: {proxy_host}
#
# Reads user mailbox paths from Dovecot users file and scans
# Junk/Spam folders for messages to learn.
#
# Cron (every 2 hours):
#   0 */2 * * * /usr/local/bin/dovecot-learn.sh >> /var/log/spamproxy-learn.log 2>&1

SPAMPROXY_URL="{api_url}"
USERS_FILE="{users_file}"
JUNK_FOLDERS="{junk_folders}"
MAX_AGE={max_age}
MAX_MSGS=200
LEARN_HAM={str(learn_ham).lower()}
STATE_DIR="/var/lib/spamproxy/learn-state"

log()  {{ echo "$(date '+%H:%M:%S') [learn] $1"; }}
warn() {{ echo "$(date '+%H:%M:%S') [learn] WARNING: $1"; }}

mkdir -p "$STATE_DIR"
SPAM_LEARNED=0
HAM_LEARNED=0
SKIPPED=0
ERRORS=0
USERS_FOUND=0

is_processed() {{ [ -f "$STATE_DIR/${{2}}_${{1}}" ]; }}
mark_processed() {{ touch "$STATE_DIR/${{2}}_${{1}}"; }}

learn_message() {{
    local file="$1" type="$2"
    local hash
    hash=$(echo "$file" | md5sum | cut -d' ' -f1)
    is_processed "$hash" "$type" && {{ SKIPPED=$((SKIPPED + 1)); return 0; }}

    local code
    code=$(curl -s -o /dev/null -w "%{{http_code}}" \\
        -X POST "${{SPAMPROXY_URL}}/api/learn/${{type}}" \\
        -H "Content-Type: application/octet-stream" \\
        --data-binary "@${{file}}" \\
        --max-time 30 2>/dev/null || echo "000")

    if [ "$code" = "200" ]; then
        mark_processed "$hash" "$type"
        if [ "$type" = "spam" ]; then
            SPAM_LEARNED=$((SPAM_LEARNED + 1))
        else
            HAM_LEARNED=$((HAM_LEARNED + 1))
        fi
    else
        ERRORS=$((ERRORS + 1))
    fi
}}

scan_maildir() {{
    local maildir="$1" type="$2"
    for subdir in cur new; do
        local dir="${{maildir}}/${{subdir}}"
        [ -d "$dir" ] || continue
        local count
        count=$(find "$dir" -type f -mtime "-${{MAX_AGE}}" 2>/dev/null | wc -l)
        [ "$count" -eq 0 ] && continue
        log "$type ($count msgs): $dir"
        find "$dir" -type f -mtime "-${{MAX_AGE}}" 2>/dev/null | head -n "$MAX_MSGS" | while read -r file; do
            learn_message "$file" "$type"
        done
    done
}}

log "=== SpamProxy Dovecot Junk Learner ==="
log "SpamProxy: $SPAMPROXY_URL"
log "Users file: $USERS_FILE"
log "Junk folders: $JUNK_FOLDERS"
log "Max age: ${{MAX_AGE}} days, Learn ham: $LEARN_HAM"

# Check users file
if [ ! -f "$USERS_FILE" ]; then
    for f in /etc/dovecot/users /etc/dovecot/passwd /etc/dovecot/userdb; do
        [ -f "$f" ] && {{ USERS_FILE="$f"; log "Found users file: $f"; break; }}
    done
fi
if [ ! -f "$USERS_FILE" ]; then
    echo "ERROR: Dovecot users file not found. Set USERS_FILE."
    exit 1
fi

# Parse users file: email:{{CRYPT}}hash:uid:gid::mail_path::quota
while IFS= read -r line; do
    [[ -z "$line" || "$line" == "#"* ]] && continue

    local_email=$(echo "$line" | cut -d: -f1)
    mail_path=$(echo "$line" | cut -d: -f6)

    [ -z "$mail_path" ] && continue
    [ ! -d "$mail_path" ] && continue

    USERS_FOUND=$((USERS_FOUND + 1))

    # Find Maildir root
    maildir=""
    if [ -d "${{mail_path}}/Maildir" ]; then
        maildir="${{mail_path}}/Maildir"
    elif [ -d "${{mail_path}}/cur" ]; then
        maildir="$mail_path"
    elif [ -d "${{mail_path}}/mail" ]; then
        maildir="${{mail_path}}/mail"
    else
        found=$(find "$mail_path" -maxdepth 3 -name "cur" -type d 2>/dev/null | head -1)
        [ -n "${{found:-}}" ] && maildir=$(dirname "$found")
    fi
    [ -z "${{maildir:-}}" ] && continue

    # Scan Junk/Spam folders
    IFS=',' read -ra JUNK_ARR <<< "$JUNK_FOLDERS"
    for junk_name in "${{JUNK_ARR[@]}}"; do
        for junk_path in \\
            "${{maildir}}/.${{junk_name}}" \\
            "${{maildir}}/${{junk_name}}" \\
            "${{mail_path}}/.${{junk_name}}" \\
            "${{mail_path}}/${{junk_name}}"; do
            [ -d "$junk_path" ] && scan_maildir "$junk_path" "spam"
        done
    done

    # Learn ham from inbox
    if [ "$LEARN_HAM" = "true" ] && [ -d "${{maildir}}/cur" ]; then
        scan_maildir "$maildir" "ham"
    fi

done < "$USERS_FILE"

# Cleanup old state
find "$STATE_DIR" -type f -mtime +90 -delete 2>/dev/null || true

log ""
log "=== Results ==="
log "Users:   $USERS_FOUND"
log "Spam:    $SPAM_LEARNED learned"
log "Ham:     $HAM_LEARNED learned"
log "Skipped: $SKIPPED"
log "Errors:  $ERRORS"
'''
