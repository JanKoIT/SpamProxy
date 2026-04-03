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

# Auto-update from git before any command
if [ -d .git ]; then
    log "Pruefe auf Updates..."
    git fetch --quiet 2>/dev/null || true
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "$LOCAL")
    if [ "$LOCAL" != "$REMOTE" ]; then
        log "Neue Version verfuegbar, aktualisiere..."
        git pull --ff-only || { warn "Git pull fehlgeschlagen, fahre mit lokaler Version fort"; }
    else
        log "Bereits auf neuestem Stand"
    fi
fi

# ─── First Install ───────────────────────────────────────────────
first_install() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       SpamProxy - Erstinstallation       ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # ── Interactive Setup ─────────────────────────────────────
    read -p "Hostname fuer den Proxy (z.B. mail.example.com): " INPUT_HOSTNAME
    INPUT_HOSTNAME="${INPUT_HOSTNAME:-proxy.example.com}"

    read -p "Admin E-Mail-Adresse: " INPUT_EMAIL
    INPUT_EMAIL="${INPUT_EMAIL:-admin@$INPUT_HOSTNAME}"

    ADMIN_PASS=$(openssl rand -hex 8)
    read -p "Admin-Passwort [$ADMIN_PASS]: " INPUT_PASS
    ADMIN_PASS="${INPUT_PASS:-$ADMIN_PASS}"

    read -p "OpenAI API-Key (leer = AI deaktiviert): " INPUT_AI_KEY

    echo ""
    log "Konfiguration:"
    log "  Hostname:  $INPUT_HOSTNAME"
    log "  Admin:     $INPUT_EMAIL"
    log "  Passwort:  $ADMIN_PASS"
    log "  AI:        ${INPUT_AI_KEY:+aktiviert}${INPUT_AI_KEY:-deaktiviert}"
    echo ""
    read -p "Installation starten? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log "Abgebrochen."
        exit 0
    fi

    # ── Install Dependencies ──────────────────────────────────
    log "Pruefe Abhaengigkeiten..."
    if ! command -v docker &>/dev/null; then
        log "Installiere Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
    fi

    if ! command -v nginx &>/dev/null; then
        log "Installiere Nginx + Certbot..."
        apt-get update -qq
        apt-get install -y -qq nginx certbot python3-certbot-nginx
        systemctl enable nginx
    fi

    # ── Generate .env ─────────────────────────────────────────
    log "Erstelle Konfiguration..."
    cp .env.example .env
    PGPASS=$(openssl rand -hex 16)
    NEXTAUTH_SECRET=$(openssl rand -hex 32)
    RSPAMD_PASS=$(openssl rand -hex 12)

    sed -i "s/POSTGRES_PASSWORD=changeme/POSTGRES_PASSWORD=$PGPASS/" .env
    sed -i "s/NEXTAUTH_SECRET=generate-a-secret-here/NEXTAUTH_SECRET=$NEXTAUTH_SECRET/" .env
    sed -i "s/RSPAMD_PASSWORD=changeme/RSPAMD_PASSWORD=$RSPAMD_PASS/" .env
    sed -i "s/ADMIN_PASSWORD=changeme/ADMIN_PASSWORD=$ADMIN_PASS/" .env
    sed -i "s/ADMIN_EMAIL=admin@example.com/ADMIN_EMAIL=$INPUT_EMAIL/" .env
    sed -i "s/PROXY_HOSTNAME=proxy.example.com/PROXY_HOSTNAME=$INPUT_HOSTNAME/" .env
    if [ -n "$INPUT_AI_KEY" ]; then
        sed -i "s/AI_API_KEY=sk-your-key-here/AI_API_KEY=$INPUT_AI_KEY/" .env
    else
        sed -i "s/AI_ENABLED=true/AI_ENABLED=false/" .env 2>/dev/null || true
    fi

    # ── Cleanup ───────────────────────────────────────────────
    log "Raeume alte Container und Daten auf..."
    docker compose down --remove-orphans -v 2>/dev/null || true
    $COMPOSE down --remove-orphans -v 2>/dev/null || true
    docker ps -a --filter "name=spamproxy" -q | xargs -r docker rm -f 2>/dev/null || true
    docker network rm spamproxy_default 2>/dev/null || true
    # Remove all spamproxy volumes for clean DB init
    docker volume ls -q --filter "name=spamproxy" | xargs -r docker volume rm 2>/dev/null || true

    log "Starte Docker-Daemon neu..."
    systemctl restart docker
    for i in $(seq 1 30); do
        docker info >/dev/null 2>&1 && break
        sleep 1
    done
    log "Docker bereit"

    # ── Build & Start ─────────────────────────────────────────
    log "Baue Container (kann beim ersten Mal einige Minuten dauern)..."
    $COMPOSE build

    log "Starte Services..."
    $COMPOSE up -d

    log "Warte auf Datenbank..."
    for i in $(seq 1 30); do
        $COMPOSE exec -T postgres pg_isready -U spamproxy >/dev/null 2>&1 && break
        sleep 1
    done
    sleep 3

    # Update admin user with the configured email and password
    log "Setze Admin-Zugangsdaten..."
    $COMPOSE exec -T postgres psql -U spamproxy -d spamproxy -c "
        UPDATE users SET
            email = '$INPUT_EMAIL',
            password_hash = crypt('$ADMIN_PASS', gen_salt('bf'))
        WHERE role = 'admin';
        -- Insert if no admin exists
        INSERT INTO users (email, name, password_hash, role)
        SELECT '$INPUT_EMAIL', 'Administrator', crypt('$ADMIN_PASS', gen_salt('bf')), 'admin'
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
    " 2>/dev/null || warn "Admin-Update fehlgeschlagen"

    # ── Nginx + TLS ───────────────────────────────────────────
    log "Konfiguriere Nginx..."
    rm -f /etc/nginx/sites-available/spamproxy /etc/nginx/sites-enabled/spamproxy 2>/dev/null || true
    cp docker/nginx/spamproxy.conf /etc/nginx/sites-available/spamproxy
    sed -i "s/spamproxy.example.com/$INPUT_HOSTNAME/g" /etc/nginx/sites-available/spamproxy
    ln -sf /etc/nginx/sites-available/spamproxy /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        log "Nginx konfiguriert fuer $INPUT_HOSTNAME"

        # TLS
        log "Hole TLS-Zertifikat..."
        if certbot --nginx -d "$INPUT_HOSTNAME" --non-interactive --agree-tos \
            --email "$INPUT_EMAIL" 2>/dev/null; then
            log "TLS-Zertifikat installiert"
        else
            warn "Certbot fehlgeschlagen - stelle sicher dass DNS auf diesen Server zeigt"
            warn "Manuell nachholen: sudo certbot --nginx -d $INPUT_HOSTNAME"
        fi
    else
        warn "Nginx-Config fehlerhaft - bitte manuell pruefen"
    fi

    # ── Firewall ──────────────────────────────────────────────
    if command -v ufw &>/dev/null; then
        log "Konfiguriere Firewall..."
        ufw allow 22/tcp comment "SSH" 2>/dev/null || true
        ufw allow 25/tcp comment "SMTP" 2>/dev/null || true
        ufw allow 587/tcp comment "SMTP Submission" 2>/dev/null || true
        ufw allow 80/tcp comment "HTTP" 2>/dev/null || true
        ufw allow 443/tcp comment "HTTPS" 2>/dev/null || true
        ufw --force enable 2>/dev/null || true
        log "Firewall konfiguriert"
    fi

    # ── Done ──────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       Installation abgeschlossen!        ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Web-Interface:  ${GREEN}https://$INPUT_HOSTNAME${NC}"
    echo -e "  Admin-Login:    ${GREEN}$INPUT_EMAIL${NC}"
    echo -e "  Admin-Passwort: ${GREEN}$ADMIN_PASS${NC}"
    echo ""
    echo -e "  ${YELLOW}Naechste Schritte:${NC}"
    echo -e "  1. DNS: MX-Record fuer deine Domain auf ${GREEN}$INPUT_HOSTNAME${NC} setzen"
    echo -e "  2. DNS: A-Record fuer ${GREEN}$INPUT_HOSTNAME${NC} auf $(curl -4s ifconfig.me 2>/dev/null || echo '<SERVER-IP>')"
    echo -e "  3. Backups einrichten: ${GREEN}sudo ./scripts/setup-cron.sh${NC}"
    echo ""
    echo -e "  Konfiguration:  ${YELLOW}$PROJECT_DIR/.env${NC}"
    echo -e "  Logs:           ${YELLOW}./scripts/deploy.sh logs${NC}"
    echo -e "  Status:         ${YELLOW}./scripts/deploy.sh status${NC}"
    echo ""
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

    # (git pull already done at script start)

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
