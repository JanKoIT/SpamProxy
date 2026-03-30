#!/bin/bash
set -euo pipefail

# SpamProxy Backup Script
# Usage: ./scripts/backup.sh [full|db|quick] [--retain DAYS]
#
# Typen:
#   full  - Datenbank + DKIM-Keys + rspamd-Daten + Config (Standard)
#   db    - Nur Datenbank
#   quick - Nur Datenbank (ohne Komprimierung, schnell)
#
# Automatisierung: crontab -e
#   0 2 * * * /opt/spamproxy/scripts/backup.sh full --retain 30 >> /var/log/spamproxy-backup.log 2>&1
#   0 */6 * * * /opt/spamproxy/scripts/backup.sh db --retain 7 >> /var/log/spamproxy-backup.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose"
BACKUP_DIR="${SPAMPROXY_BACKUP_DIR:-$PROJECT_DIR/backups}"
RETAIN_DAYS=30
BACKUP_TYPE="full"
DATE=$(date +%Y%m%d_%H%M%S)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "$(date '+%Y-%m-%d %H:%M:%S') ${GREEN}[backup]${NC} $1"; }
warn() { echo -e "$(date '+%Y-%m-%d %H:%M:%S') ${YELLOW}[backup]${NC} $1"; }
err()  { echo -e "$(date '+%Y-%m-%d %H:%M:%S') ${RED}[backup]${NC} $1"; }

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        full|db|quick) BACKUP_TYPE="$1"; shift ;;
        --retain)      RETAIN_DAYS="$2"; shift 2 ;;
        --dir)         BACKUP_DIR="$2"; shift 2 ;;
        *)             err "Unbekannter Parameter: $1"; exit 1 ;;
    esac
done

cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR"

BACKUP_NAME="spamproxy_${BACKUP_TYPE}_${DATE}"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
mkdir -p "$BACKUP_PATH"

log "=== SpamProxy Backup ($BACKUP_TYPE) ==="
log "Ziel: $BACKUP_PATH"

# ─── Datenbank ───────────────────────────────────────────────────
backup_database() {
    log "Datenbank-Backup..."
    if [ "$BACKUP_TYPE" = "quick" ]; then
        $COMPOSE exec -T postgres pg_dump -U spamproxy \
            --format=plain spamproxy > "$BACKUP_PATH/database.sql"
    else
        $COMPOSE exec -T postgres pg_dump -U spamproxy \
            --format=custom --compress=6 spamproxy > "$BACKUP_PATH/database.dump"
    fi
    log "  Datenbank: $(du -h "$BACKUP_PATH"/database.* | cut -f1)"
}

# ─── DKIM Keys ───────────────────────────────────────────────────
backup_dkim() {
    log "DKIM-Keys..."
    DKIM_CONTAINER_PATH="/var/lib/rspamd/dkim"
    mkdir -p "$BACKUP_PATH/dkim"
    $COMPOSE exec -T mail-service sh -c "
        if [ -d $DKIM_CONTAINER_PATH ] && [ \"\$(ls -A $DKIM_CONTAINER_PATH 2>/dev/null)\" ]; then
            tar cf - -C $DKIM_CONTAINER_PATH .
        else
            echo 'EMPTY' >&2
        fi
    " > "$BACKUP_PATH/dkim/keys.tar" 2>/dev/null || true

    if [ -s "$BACKUP_PATH/dkim/keys.tar" ]; then
        log "  DKIM-Keys: $(du -h "$BACKUP_PATH/dkim/keys.tar" | cut -f1)"
    else
        rm -rf "$BACKUP_PATH/dkim"
        log "  DKIM-Keys: keine vorhanden"
    fi
}

# ─── rspamd Daten (Bayes, Statistiken) ───────────────────────────
backup_rspamd() {
    log "rspamd Bayes-Daten (Redis)..."
    $COMPOSE exec -T redis redis-cli BGSAVE > /dev/null 2>&1 || true
    sleep 2
    $COMPOSE exec -T redis cat /data/dump.rdb > "$BACKUP_PATH/redis.rdb" 2>/dev/null || true
    if [ -s "$BACKUP_PATH/redis.rdb" ]; then
        log "  Redis: $(du -h "$BACKUP_PATH/redis.rdb" | cut -f1)"
    else
        rm -f "$BACKUP_PATH/redis.rdb"
        log "  Redis: Backup fehlgeschlagen (nicht kritisch)"
    fi
}

# ─── Konfiguration ───────────────────────────────────────────────
backup_config() {
    log "Konfiguration..."
    mkdir -p "$BACKUP_PATH/config"
    # .env (ohne Secrets im Dateinamen)
    cp "$PROJECT_DIR/.env" "$BACKUP_PATH/config/env" 2>/dev/null || true
    # rspamd config
    if [ -d "$PROJECT_DIR/docker/rspamd/local.d" ]; then
        cp -r "$PROJECT_DIR/docker/rspamd/local.d" "$BACKUP_PATH/config/rspamd_local.d"
    fi
    # Postfix config
    for f in main.cf master.cf; do
        cp "$PROJECT_DIR/docker/postfix/$f" "$BACKUP_PATH/config/" 2>/dev/null || true
    done
    log "  Config: $(du -sh "$BACKUP_PATH/config" | cut -f1)"
}

# ─── Ausfuehren ─────────────────────────────────────────────────
case "$BACKUP_TYPE" in
    full)
        backup_database
        backup_dkim
        backup_rspamd
        backup_config
        ;;
    db)
        backup_database
        ;;
    quick)
        backup_database
        ;;
esac

# ─── Komprimieren ────────────────────────────────────────────────
log "Komprimiere..."
ARCHIVE="$BACKUP_DIR/${BACKUP_NAME}.tar.gz"
tar czf "$ARCHIVE" -C "$BACKUP_DIR" "$BACKUP_NAME"
rm -rf "$BACKUP_PATH"
log "Archiv: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# ─── Alte Backups aufraeumen ─────────────────────────────────────
log "Raeume Backups aelter als $RETAIN_DAYS Tage auf..."
DELETED=$(find "$BACKUP_DIR" -name "spamproxy_*.tar.gz" -mtime +$RETAIN_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "  $DELETED alte Backups geloescht"
fi

# ─── Zusammenfassung ─────────────────────────────────────────────
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "spamproxy_*.tar.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log ""
log "=== Backup abgeschlossen ==="
log "Datei:    $ARCHIVE"
log "Backups:  $TOTAL_BACKUPS gesamt ($TOTAL_SIZE)"
log "Rotation: $RETAIN_DAYS Tage"
