#!/bin/bash
set -euo pipefail

# Richtet automatische Backups per Cron ein
# Usage: sudo ./scripts/setup-cron.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[setup]${NC} $1"; }

# Log-Verzeichnis
mkdir -p /var/log
touch /var/log/spamproxy-backup.log

# Crontab-Eintraege
CRON_ENTRIES="
# SpamProxy Backups
# Volles Backup taeglich um 02:00, 30 Tage behalten
0 2 * * * cd $PROJECT_DIR && $SCRIPT_DIR/backup.sh full --retain 30 >> /var/log/spamproxy-backup.log 2>&1

# Schnelles DB-Backup alle 6 Stunden, 7 Tage behalten
0 */6 * * * cd $PROJECT_DIR && $SCRIPT_DIR/backup.sh db --retain 7 >> /var/log/spamproxy-backup.log 2>&1

# Backup-Log rotieren (woechentlich)
0 3 * * 0 truncate -s 0 /var/log/spamproxy-backup.log
"

# Pruefen ob schon eingerichtet
if crontab -l 2>/dev/null | grep -q "spamproxy"; then
    log "SpamProxy-Cron existiert bereits. Aktuelle Eintraege:"
    crontab -l | grep -A1 "spamproxy\|backup.sh"
    echo ""
    read -p "Ueberschreiben? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Abgebrochen."
        exit 0
    fi
    # Bestehende SpamProxy-Eintraege entfernen
    crontab -l | grep -v "spamproxy\|backup.sh" | crontab -
fi

# Neue Eintraege hinzufuegen
(crontab -l 2>/dev/null; echo "$CRON_ENTRIES") | crontab -

log "Cron-Jobs eingerichtet:"
echo ""
echo "  - Volles Backup:  taeglich 02:00 (30 Tage)"
echo "  - DB-Backup:      alle 6h (7 Tage)"
echo "  - Log-Rotation:   woechentlich"
echo ""
log "Backup-Verzeichnis: $PROJECT_DIR/backups/"
log "Backup-Log: /var/log/spamproxy-backup.log"
echo ""
log "Pruefen mit: crontab -l"
log "Manuell ausfuehren: $SCRIPT_DIR/backup.sh full"
