#!/bin/bash
set -euo pipefail

# SpamProxy Restore Script
# Usage: ./scripts/restore.sh <backup-archive.tar.gz> [--component db|dkim|redis|config|all]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[restore]${NC} $1"; }
warn() { echo -e "${YELLOW}[restore]${NC} $1"; }
err()  { echo -e "${RED}[restore]${NC} $1"; }

ARCHIVE="${1:-}"
COMPONENT="${3:-all}"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
    echo "SpamProxy Restore"
    echo ""
    echo "Usage: $0 <backup-archive.tar.gz> [--component db|dkim|redis|config|all]"
    echo ""
    echo "Verfuegbare Backups:"
    ls -lht "$PROJECT_DIR/backups/"*.tar.gz 2>/dev/null | head -10 || echo "  (keine)"
    exit 1
fi

# Parse --component
while [[ $# -gt 1 ]]; do
    case "$2" in
        --component) COMPONENT="$3"; shift 2 ;;
        *) shift ;;
    esac
done

cd "$PROJECT_DIR"

# Extract
TMPDIR=$(mktemp -d)
log "Entpacke $ARCHIVE..."
tar xzf "$ARCHIVE" -C "$TMPDIR"
BACKUP_DIR=$(ls "$TMPDIR")
BACKUP_PATH="$TMPDIR/$BACKUP_DIR"

log "Backup: $BACKUP_DIR"
log "Inhalt:"
ls -la "$BACKUP_PATH/" 2>/dev/null
echo ""

# ─── Database Restore ────────────────────────────────────────────
restore_database() {
    if [ -f "$BACKUP_PATH/database.dump" ]; then
        warn "ACHTUNG: Datenbank wird komplett ueberschrieben!"
        read -p "Fortfahren? (y/N) " -n 1 -r
        echo
        [[ ! $REPLY =~ ^[Yy]$ ]] && return

        log "Stelle Datenbank wieder her (custom format)..."
        # Terminate connections
        $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='spamproxy' AND pid != pg_backend_pid();" 2>/dev/null || true
        $COMPOSE exec -T postgres dropdb -U spamproxy --if-exists spamproxy 2>/dev/null || true
        $COMPOSE exec -T postgres createdb -U spamproxy spamproxy 2>/dev/null || true
        $COMPOSE exec -T postgres pg_restore -U spamproxy -d spamproxy --no-owner --no-privileges \
            < "$BACKUP_PATH/database.dump"
        log "Datenbank wiederhergestellt"

    elif [ -f "$BACKUP_PATH/database.sql" ]; then
        warn "ACHTUNG: Datenbank wird komplett ueberschrieben!"
        read -p "Fortfahren? (y/N) " -n 1 -r
        echo
        [[ ! $REPLY =~ ^[Yy]$ ]] && return

        log "Stelle Datenbank wieder her (SQL format)..."
        $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='spamproxy' AND pid != pg_backend_pid();" 2>/dev/null || true
        $COMPOSE exec -T postgres dropdb -U spamproxy --if-exists spamproxy 2>/dev/null || true
        $COMPOSE exec -T postgres createdb -U spamproxy spamproxy 2>/dev/null || true
        $COMPOSE exec -T postgres psql -U spamproxy -d spamproxy \
            < "$BACKUP_PATH/database.sql"
        log "Datenbank wiederhergestellt"
    else
        warn "Kein Datenbank-Backup gefunden"
    fi
}

# ─── DKIM Restore ────────────────────────────────────────────────
restore_dkim() {
    if [ -f "$BACKUP_PATH/dkim/keys.tar" ]; then
        log "Stelle DKIM-Keys wieder her..."
        $COMPOSE exec -T mail-service sh -c "
            mkdir -p /var/lib/rspamd/dkim
            cd /var/lib/rspamd/dkim
            tar xf -
        " < "$BACKUP_PATH/dkim/keys.tar"
        log "DKIM-Keys wiederhergestellt"
    else
        warn "Kein DKIM-Backup gefunden"
    fi
}

# ─── Redis Restore ───────────────────────────────────────────────
restore_redis() {
    if [ -f "$BACKUP_PATH/redis.rdb" ]; then
        warn "Redis-Daten werden ueberschrieben (Bayes-Training, Fuzzy-Hashes)"
        read -p "Fortfahren? (y/N) " -n 1 -r
        echo
        [[ ! $REPLY =~ ^[Yy]$ ]] && return

        log "Stelle Redis-Daten wieder her..."
        $COMPOSE stop redis
        docker cp "$BACKUP_PATH/redis.rdb" "$(docker compose ps -q redis)":/data/dump.rdb 2>/dev/null || \
            warn "Redis Container nicht gefunden - ueberspringe"
        $COMPOSE start redis
        sleep 3
        log "Redis-Daten wiederhergestellt"
    else
        warn "Kein Redis-Backup gefunden"
    fi
}

# ─── Config Restore ──────────────────────────────────────────────
restore_config() {
    if [ -d "$BACKUP_PATH/config" ]; then
        log "Konfiguration gefunden:"
        ls -la "$BACKUP_PATH/config/"
        echo ""
        warn "Konfigurationen werden NICHT automatisch ueberschrieben."
        warn "Bitte manuell vergleichen und uebernehmen:"
        echo ""

        if [ -f "$BACKUP_PATH/config/env" ]; then
            log "  .env Backup: $BACKUP_PATH/config/env"
            if command -v diff &>/dev/null && [ -f "$PROJECT_DIR/.env" ]; then
                log "  Unterschiede:"
                diff --color "$PROJECT_DIR/.env" "$BACKUP_PATH/config/env" || true
            fi
        fi
        echo ""
        log "Dateien liegen in: $BACKUP_PATH/config/"
        log "Kopiere manuell was du brauchst."
    else
        warn "Kein Config-Backup gefunden"
    fi
}

# ─── Execute ─────────────────────────────────────────────────────
log "=== SpamProxy Restore ($COMPONENT) ==="
echo ""

case "$COMPONENT" in
    all)
        restore_database
        restore_dkim
        restore_redis
        restore_config
        ;;
    db)      restore_database ;;
    dkim)    restore_dkim ;;
    redis)   restore_redis ;;
    config)  restore_config ;;
    *)       err "Unbekannte Komponente: $COMPONENT"; exit 1 ;;
esac

# Restart services
if [ "$COMPONENT" = "all" ] || [ "$COMPONENT" = "db" ]; then
    log ""
    log "Starte Services neu..."
    $COMPOSE restart mail-service web
    sleep 3
fi

# Cleanup
rm -rf "$TMPDIR"

log ""
log "=== Restore abgeschlossen ==="
