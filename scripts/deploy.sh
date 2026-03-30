#!/bin/bash
set -euo pipefail

# SpamProxy VPS Deployment Script
# Usage: ./scripts/deploy.sh [first-install|update]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SpamProxy]${NC} $1"; }
warn() { echo -e "${YELLOW}[SpamProxy]${NC} $1"; }
err()  { echo -e "${RED}[SpamProxy]${NC} $1"; }

cd "$PROJECT_DIR"

# ─── First Install ───────────────────────────────────────────────
first_install() {
    log "=== SpamProxy Erstinstallation ==="

    # Check prerequisites
    if ! command -v docker &>/dev/null; then
        err "Docker nicht installiert. Installiere: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    if ! command -v nginx &>/dev/null; then
        warn "Nginx nicht installiert. Installiere: apt install nginx certbot python3-certbot-nginx"
    fi

    # Create .env if not exists
    if [ ! -f .env ]; then
        cp .env.example .env
        # Generate secure passwords
        PGPASS=$(openssl rand -hex 16)
        NEXTAUTH_SECRET=$(openssl rand -hex 32)
        RSPAMD_PASS=$(openssl rand -hex 12)
        sed -i "s/POSTGRES_PASSWORD=changeme/POSTGRES_PASSWORD=$PGPASS/" .env
        sed -i "s/NEXTAUTH_SECRET=generate-a-secret-here/NEXTAUTH_SECRET=$NEXTAUTH_SECRET/" .env
        sed -i "s/RSPAMD_PASSWORD=changeme/RSPAMD_PASSWORD=$RSPAMD_PASS/" .env
        sed -i "s/ADMIN_PASSWORD=changeme/ADMIN_PASSWORD=$(openssl rand -hex 8)/" .env
        log "Sichere Passwoerter generiert in .env"
        warn "WICHTIG: Oeffne .env und setze PROXY_HOSTNAME und ADMIN_EMAIL"
    fi

    # Build and start
    log "Baue Container..."
    $COMPOSE build

    log "Starte Services..."
    $COMPOSE up -d

    log "Warte auf PostgreSQL..."
    sleep 10

    # Setup firewall
    if command -v ufw &>/dev/null; then
        log "Konfiguriere Firewall..."
        ufw allow 25/tcp comment "SMTP"
        ufw allow 587/tcp comment "SMTP Submission"
        ufw allow 80/tcp comment "HTTP"
        ufw allow 443/tcp comment "HTTPS"
        # Blockiere direkten Zugriff auf interne Ports
        ufw deny 3080/tcp comment "SpamProxy Web (nur via Nginx)"
        ufw deny 8025/tcp comment "SpamProxy API (intern)"
        ufw deny 11334/tcp comment "rspamd Web (intern)"
        log "Firewall konfiguriert"
    fi

    log ""
    log "=== Installation abgeschlossen ==="
    log ""
    log "Naechste Schritte:"
    log "1. .env anpassen (PROXY_HOSTNAME, ADMIN_EMAIL, AI_API_KEY)"
    log "2. Nginx einrichten:"
    log "   sudo cp docker/nginx/spamproxy.conf /etc/nginx/sites-available/spamproxy"
    log "   sudo ln -s /etc/nginx/sites-available/spamproxy /etc/nginx/sites-enabled/"
    log "   # Domain in der Config anpassen, dann:"
    log "   sudo certbot --nginx -d dein-hostname.de"
    log "   sudo systemctl reload nginx"
    log "3. DNS MX-Record auf $PROXY_HOSTNAME setzen"
    log "4. Backups einrichten:"
    log "   sudo ./scripts/setup-cron.sh"
    log "5. Web-Interface: https://dein-hostname.de"
    log ""
    source .env 2>/dev/null
    log "Admin-Login: ${ADMIN_EMAIL:-admin@example.com}"
    log "Admin-Passwort: steht in .env (ADMIN_PASSWORD)"
}

# ─── Update ──────────────────────────────────────────────────────
update() {
    log "=== SpamProxy Update ==="

    # Backup database
    log "Erstelle Datenbank-Backup..."
    mkdir -p backups
    BACKUP_FILE="backups/spamproxy_$(date +%Y%m%d_%H%M%S).sql"
    $COMPOSE exec -T postgres pg_dump -U spamproxy spamproxy > "$BACKUP_FILE" 2>/dev/null
    log "Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

    # Pull latest code (if git)
    if [ -d .git ]; then
        log "Hole neuesten Code..."
        git pull --ff-only || { warn "Git pull fehlgeschlagen - ueberspringe"; }
    fi

    # Rebuild only changed images
    log "Baue aktualisierte Container..."
    $COMPOSE build

    # Rolling update - restart services one by one
    log "Update mail-service..."
    $COMPOSE up -d --no-deps --force-recreate mail-service
    sleep 3

    log "Update web..."
    $COMPOSE up -d --no-deps --force-recreate web
    sleep 2

    log "Update rspamd..."
    $COMPOSE up -d --no-deps --force-recreate rspamd
    sleep 2

    # Postfix last (briefly interrupts mail flow)
    log "Update postfix (kurze Mail-Unterbrechung)..."
    $COMPOSE up -d --no-deps --force-recreate postfix
    sleep 2

    # ClamAV only if image changed
    log "Pruefe ClamAV..."
    $COMPOSE up -d --no-deps clamav

    # Verify
    log "Pruefe Status..."
    $COMPOSE ps

    log ""
    log "=== Update abgeschlossen ==="
    log "Altes Backup: $BACKUP_FILE"
}

# ─── Rollback ────────────────────────────────────────────────────
rollback() {
    if [ -z "${1:-}" ]; then
        err "Usage: $0 rollback <backup-file.sql>"
        log "Verfuegbare Backups:"
        ls -lh backups/*.sql 2>/dev/null || log "  (keine)"
        exit 1
    fi

    warn "ACHTUNG: Datenbank wird ueberschrieben mit $1"
    read -p "Fortfahren? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi

    log "Stelle Datenbank wieder her..."
    $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='spamproxy' AND pid != pg_backend_pid();" 2>/dev/null
    $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c "DROP DATABASE spamproxy;" 2>/dev/null
    $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c "CREATE DATABASE spamproxy;" 2>/dev/null
    $COMPOSE exec -T postgres psql -U spamproxy -d spamproxy < "$1"

    log "Starte Services neu..."
    $COMPOSE restart mail-service web

    log "Rollback abgeschlossen."
}

# ─── Federation ──────────────────────────────────────────────────
federation_add_peer() {
    PEER_IP="${1:-}"
    PEER_NAME="${2:-peer}"
    if [ -z "$PEER_IP" ]; then
        err "Usage: $0 federation-add <peer-ip> [name]"
        exit 1
    fi

    log "Federation Peer hinzufuegen: $PEER_NAME ($PEER_IP)"

    # UFW Regeln fuer rspamd-Ports
    if command -v ufw &>/dev/null; then
        ufw allow from "$PEER_IP" to any port 11333 proto tcp comment "SpamProxy Federation: $PEER_NAME (rspamd)"
        ufw allow from "$PEER_IP" to any port 11335 proto tcp comment "SpamProxy Federation: $PEER_NAME (fuzzy)"
        log "Firewall: Ports 11333+11335 fuer $PEER_IP geoeffnet"
    fi

    # Nginx IP-Whitelist
    NGINX_CONF="/etc/nginx/sites-available/spamproxy"
    if [ -f "$NGINX_CONF" ]; then
        if ! grep -q "$PEER_IP" "$NGINX_CONF"; then
            sed -i "/# === PEER IPS HIER EINTRAGEN ===/a\\        allow $PEER_IP;     # Peer: $PEER_NAME" "$NGINX_CONF"
            nginx -t && systemctl reload nginx
            log "Nginx: IP $PEER_IP zur Federation-Whitelist hinzugefuegt"
        else
            warn "IP $PEER_IP ist bereits in der Nginx-Config"
        fi
    else
        warn "Nginx-Config nicht gefunden unter $NGINX_CONF"
        warn "Fuege manuell 'allow $PEER_IP;' zum /federation/ Block hinzu"
    fi

    log ""
    log "Peer $PEER_NAME ($PEER_IP) kann jetzt zugreifen auf:"
    log "  - rspamd API:    https://$(hostname -f)/federation/ (via Nginx)"
    log "  - rspamd direkt: $PEER_IP:11333 (learn_spam/learn_ham)"
    log "  - Fuzzy Storage: $PEER_IP:11335 (fuzzy hash sync)"
    log ""
    log "Vergiss nicht, den Peer auch im Web-Interface unter"
    log "Settings > Federation hinzuzufuegen!"
}

federation_remove_peer() {
    PEER_IP="${1:-}"
    if [ -z "$PEER_IP" ]; then
        err "Usage: $0 federation-remove <peer-ip>"
        exit 1
    fi

    log "Federation Peer entfernen: $PEER_IP"

    if command -v ufw &>/dev/null; then
        ufw delete allow from "$PEER_IP" to any port 11333 proto tcp 2>/dev/null || true
        ufw delete allow from "$PEER_IP" to any port 11335 proto tcp 2>/dev/null || true
        log "Firewall: Regeln fuer $PEER_IP entfernt"
    fi

    NGINX_CONF="/etc/nginx/sites-available/spamproxy"
    if [ -f "$NGINX_CONF" ]; then
        sed -i "/$PEER_IP/d" "$NGINX_CONF"
        nginx -t && systemctl reload nginx
        log "Nginx: IP $PEER_IP aus Federation-Whitelist entfernt"
    fi

    log "Peer $PEER_IP entfernt. Vergiss nicht, ihn auch im Web-Interface zu loeschen!"
}

federation_list() {
    log "=== Federation Peers ==="
    log ""
    log "Firewall-Regeln (Ports 11333/11335):"
    if command -v ufw &>/dev/null; then
        ufw status | grep -E "11333|11335" || log "  (keine)"
    fi
    log ""
    log "Nginx Federation-Whitelist:"
    NGINX_CONF="/etc/nginx/sites-available/spamproxy"
    if [ -f "$NGINX_CONF" ]; then
        grep "allow.*Peer:" "$NGINX_CONF" || log "  (keine)"
    fi
    log ""
    log "rspamd Verbindungstest:"
    $COMPOSE exec rspamd rspamadm control stat 2>/dev/null | head -5 || log "  rspamd nicht erreichbar"
}

# ─── Status ──────────────────────────────────────────────────────
status() {
    $COMPOSE ps
    echo ""
    log "Postfix Queue:"
    $COMPOSE exec postfix postqueue -p 2>/dev/null | tail -3
    echo ""
    log "Federation Peers (Firewall):"
    if command -v ufw &>/dev/null; then
        ufw status | grep -E "11333|11335" || log "  (keine konfiguriert)"
    fi
    echo ""
    log "Disk Usage:"
    docker system df 2>/dev/null
}

# ─── Main ────────────────────────────────────────────────────────
case "${1:-help}" in
    first-install)      first_install ;;
    update)             update ;;
    rollback)           rollback "${2:-}" ;;
    status)             status ;;
    federation-add)     federation_add_peer "${2:-}" "${3:-peer}" ;;
    federation-remove)  federation_remove_peer "${2:-}" ;;
    federation-list)    federation_list ;;
    backup)
        mkdir -p backups
        BACKUP_FILE="backups/spamproxy_$(date +%Y%m%d_%H%M%S).sql"
        $COMPOSE exec -T postgres pg_dump -U spamproxy spamproxy > "$BACKUP_FILE"
        log "Backup erstellt: $BACKUP_FILE"
        ;;
    logs)
        $COMPOSE logs -f --tail 50 ${2:-}
        ;;
    *)
        echo "SpamProxy Deployment"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  first-install            Erstinstallation auf neuem VPS"
        echo "  update                   Update auf neue Version (mit Backup)"
        echo "  rollback FILE            Datenbank-Rollback auf Backup"
        echo "  backup                   Manuelles Datenbank-Backup"
        echo "  status                   Service-Status anzeigen"
        echo "  logs [service]           Logs anzeigen (z.B. logs postfix)"
        echo ""
        echo "Federation:"
        echo "  federation-add IP [NAME] Peer hinzufuegen (Firewall + Nginx)"
        echo "  federation-remove IP     Peer entfernen"
        echo "  federation-list          Alle Peers und Status anzeigen"
        ;;
esac
