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
    log "Checking for updates..."
    git fetch --quiet 2>/dev/null || true
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "$LOCAL")
    if [ "$LOCAL" != "$REMOTE" ]; then
        log "New version available, updating..."
        git pull --ff-only || { warn "Git pull failed, continuing with local version"; }
    else
        log "Already up to date"
    fi
fi

# ─── First Install ───────────────────────────────────────────────
first_install() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       SpamProxy - First Install           ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # ── Interactive Setup ─────────────────────────────────────
    read -p "Proxy hostname (e.g. mail.example.com): " INPUT_HOSTNAME
    INPUT_HOSTNAME="${INPUT_HOSTNAME:-proxy.example.com}"

    read -p "Admin email address: " INPUT_EMAIL
    INPUT_EMAIL="${INPUT_EMAIL:-admin@$INPUT_HOSTNAME}"

    ADMIN_PASS=$(openssl rand -hex 8)
    read -p "Admin password [$ADMIN_PASS]: " INPUT_PASS
    ADMIN_PASS="${INPUT_PASS:-$ADMIN_PASS}"

    read -p "OpenAI API key (empty = AI disabled): " INPUT_AI_KEY

    echo ""
    log "Configuration:"
    log "  Hostname:  $INPUT_HOSTNAME"
    log "  Admin:     $INPUT_EMAIL"
    log "  Password:  $ADMIN_PASS"
    log "  AI:        ${INPUT_AI_KEY:+enabled}${INPUT_AI_KEY:-disabled}"
    echo ""
    read -p "Start installation? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log "Cancelled."
        exit 0
    fi

    # ── Install Dependencies ──────────────────────────────────
    log "Checking dependencies..."
    if ! command -v docker &>/dev/null; then
        log "Installing Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
    fi

    if ! command -v nginx &>/dev/null; then
        log "Installing Nginx + Certbot..."
        apt-get update -qq
        apt-get install -y -qq nginx certbot python3-certbot-nginx
        systemctl enable nginx
    fi

    # ── Generate .env ─────────────────────────────────────────
    log "Creating configuration..."
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
    log "Cleaning up old containers and data..."
    docker compose down --remove-orphans -v 2>/dev/null || true
    $COMPOSE down --remove-orphans -v 2>/dev/null || true
    docker ps -a --filter "name=spamproxy" -q | xargs -r docker rm -f 2>/dev/null || true
    docker network rm spamproxy_default 2>/dev/null || true
    docker volume ls -q --filter "name=spamproxy" | xargs -r docker volume rm 2>/dev/null || true

    log "Restarting Docker daemon..."
    systemctl restart docker
    for i in $(seq 1 30); do
        docker info >/dev/null 2>&1 && break
        sleep 1
    done
    log "Docker ready"

    # ── Build & Start ─────────────────────────────────────────
    log "Building containers (may take a few minutes on first run)..."
    $COMPOSE build

    log "Starting services..."
    $COMPOSE up -d

    log "Waiting for database..."
    for i in $(seq 1 30); do
        $COMPOSE exec -T postgres pg_isready -U spamproxy >/dev/null 2>&1 && break
        sleep 1
    done
    sleep 3

    # Update admin user with the configured email and password
    log "Setting admin credentials..."
    $COMPOSE exec -T postgres psql -U spamproxy -d spamproxy -c "
        UPDATE users SET
            email = '$INPUT_EMAIL',
            password_hash = crypt('$ADMIN_PASS', gen_salt('bf'))
        WHERE role = 'admin';
        INSERT INTO users (email, name, password_hash, role)
        SELECT '$INPUT_EMAIL', 'Administrator', crypt('$ADMIN_PASS', gen_salt('bf')), 'admin'
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
    " 2>/dev/null || warn "Admin update failed"

    # ── Nginx + TLS ───────────────────────────────────────────
    log "Configuring Nginx..."
    rm -f /etc/nginx/sites-available/spamproxy /etc/nginx/sites-enabled/spamproxy 2>/dev/null || true
    cp docker/nginx/spamproxy.conf /etc/nginx/sites-available/spamproxy
    sed -i "s/spamproxy.example.com/$INPUT_HOSTNAME/g" /etc/nginx/sites-available/spamproxy
    ln -sf /etc/nginx/sites-available/spamproxy /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        log "Nginx configured for $INPUT_HOSTNAME"

        log "Requesting TLS certificate..."
        if certbot --nginx -d "$INPUT_HOSTNAME" --non-interactive --agree-tos \
            --email "$INPUT_EMAIL" 2>/dev/null; then
            log "TLS certificate installed"
        else
            warn "Certbot failed - make sure DNS points to this server"
            warn "Run manually: sudo certbot --nginx -d $INPUT_HOSTNAME"
        fi
    else
        warn "Nginx config error - please check manually"
    fi

    # ── Firewall ──────────────────────────────────────────────
    if command -v ufw &>/dev/null; then
        log "Configuring firewall..."
        ufw allow 22/tcp comment "SSH" 2>/dev/null || true
        ufw allow 25/tcp comment "SMTP" 2>/dev/null || true
        ufw allow 587/tcp comment "SMTP Submission" 2>/dev/null || true
        ufw allow 80/tcp comment "HTTP" 2>/dev/null || true
        ufw allow 443/tcp comment "HTTPS" 2>/dev/null || true
        ufw --force enable 2>/dev/null || true
        log "Firewall configured"
    fi

    # ── Done ──────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       Installation complete!              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Web interface:  ${GREEN}https://$INPUT_HOSTNAME${NC}"
    echo -e "  Admin login:    ${GREEN}$INPUT_EMAIL${NC}"
    echo -e "  Admin password: ${GREEN}$ADMIN_PASS${NC}"
    echo ""
    echo -e "  ${YELLOW}Next steps:${NC}"
    echo -e "  1. DNS: Set MX record for your domain to ${GREEN}$INPUT_HOSTNAME${NC}"
    echo -e "  2. DNS: Set A record for ${GREEN}$INPUT_HOSTNAME${NC} to $(curl -4s ifconfig.me 2>/dev/null || echo '<SERVER-IP>')"
    echo -e "  3. Setup backups: ${GREEN}sudo ./scripts/setup-cron.sh${NC}"
    echo ""
    echo -e "  Config:  ${YELLOW}$PROJECT_DIR/.env${NC}"
    echo -e "  Logs:    ${YELLOW}./scripts/deploy.sh logs${NC}"
    echo -e "  Status:  ${YELLOW}./scripts/deploy.sh status${NC}"
    echo ""
}

# ─── Update ──────────────────────────────────────────────────────
update() {
    log "=== SpamProxy Update ==="

    log "Creating database backup..."
    mkdir -p backups
    BACKUP_FILE="backups/spamproxy_$(date +%Y%m%d_%H%M%S).sql"
    $COMPOSE exec -T postgres pg_dump -U spamproxy spamproxy > "$BACKUP_FILE" 2>/dev/null
    log "Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

    log "Building updated containers..."
    $COMPOSE build

    log "Updating mail-service..."
    $COMPOSE up -d --no-deps --force-recreate mail-service
    sleep 3

    log "Updating web..."
    $COMPOSE up -d --no-deps --force-recreate web
    sleep 2

    log "Updating rspamd..."
    $COMPOSE up -d --no-deps --force-recreate rspamd
    sleep 2

    log "Updating postfix (brief mail interruption)..."
    $COMPOSE up -d --no-deps --force-recreate postfix
    sleep 2

    log "Checking ClamAV..."
    $COMPOSE up -d --no-deps clamav

    log "Checking status..."
    $COMPOSE ps

    log ""
    log "=== Update complete ==="
    log "Backup: $BACKUP_FILE"
}

# ─── Rollback ────────────────────────────────────────────────────
rollback() {
    if [ -z "${1:-}" ]; then
        err "Usage: $0 rollback <backup-file.sql>"
        log "Available backups:"
        ls -lh backups/*.sql 2>/dev/null || log "  (none)"
        exit 1
    fi

    warn "WARNING: Database will be overwritten with $1"
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi

    log "Restoring database..."
    $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='spamproxy' AND pid != pg_backend_pid();" 2>/dev/null
    $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c "DROP DATABASE spamproxy;" 2>/dev/null
    $COMPOSE exec -T postgres psql -U spamproxy -d postgres -c "CREATE DATABASE spamproxy;" 2>/dev/null
    $COMPOSE exec -T postgres psql -U spamproxy -d spamproxy < "$1"

    log "Restarting services..."
    $COMPOSE restart mail-service web

    log "Rollback complete."
}

# ─── Federation ──────────────────────────────────────────────────
federation_add_peer() {
    PEER_IP="${1:-}"
    PEER_NAME="${2:-peer}"
    if [ -z "$PEER_IP" ]; then
        err "Usage: $0 federation-add <peer-ip> [name]"
        exit 1
    fi

    log "Adding federation peer: $PEER_NAME ($PEER_IP)"

    if command -v ufw &>/dev/null; then
        ufw allow from "$PEER_IP" to any port 11333 proto tcp comment "SpamProxy Federation: $PEER_NAME (rspamd)"
        ufw allow from "$PEER_IP" to any port 11335 proto tcp comment "SpamProxy Federation: $PEER_NAME (fuzzy)"
        log "Firewall: Ports 11333+11335 opened for $PEER_IP"
    fi

    NGINX_CONF="/etc/nginx/sites-available/spamproxy"
    if [ -f "$NGINX_CONF" ]; then
        if ! grep -q "$PEER_IP" "$NGINX_CONF"; then
            sed -i "/# === PEER IPS HIER EINTRAGEN ===/a\\        allow $PEER_IP;     # Peer: $PEER_NAME" "$NGINX_CONF"
            nginx -t && systemctl reload nginx
            log "Nginx: IP $PEER_IP added to federation whitelist"
        else
            warn "IP $PEER_IP already in Nginx config"
        fi
    else
        warn "Nginx config not found at $NGINX_CONF"
        warn "Manually add 'allow $PEER_IP;' to the /federation/ block"
    fi

    log ""
    log "Peer $PEER_NAME ($PEER_IP) can now access:"
    log "  - rspamd API:    https://$(hostname -f)/federation/ (via Nginx)"
    log "  - rspamd direct: port 11333 (learn_spam/learn_ham)"
    log "  - Fuzzy storage: port 11335 (fuzzy hash sync)"
    log ""
    log "Don't forget to add the peer in the web interface under"
    log "Settings > Federation!"
}

federation_remove_peer() {
    PEER_IP="${1:-}"
    if [ -z "$PEER_IP" ]; then
        err "Usage: $0 federation-remove <peer-ip>"
        exit 1
    fi

    log "Removing federation peer: $PEER_IP"

    if command -v ufw &>/dev/null; then
        ufw delete allow from "$PEER_IP" to any port 11333 proto tcp 2>/dev/null || true
        ufw delete allow from "$PEER_IP" to any port 11335 proto tcp 2>/dev/null || true
        log "Firewall: Rules for $PEER_IP removed"
    fi

    NGINX_CONF="/etc/nginx/sites-available/spamproxy"
    if [ -f "$NGINX_CONF" ]; then
        sed -i "/$PEER_IP/d" "$NGINX_CONF"
        nginx -t && systemctl reload nginx
        log "Nginx: IP $PEER_IP removed from federation whitelist"
    fi

    log "Peer $PEER_IP removed. Don't forget to delete it in the web interface too!"
}

federation_list() {
    log "=== Federation Peers ==="
    log ""
    log "Firewall rules (ports 11333/11335):"
    if command -v ufw &>/dev/null; then
        ufw status | grep -E "11333|11335" || log "  (none)"
    fi
    log ""
    log "Nginx federation whitelist:"
    NGINX_CONF="/etc/nginx/sites-available/spamproxy"
    if [ -f "$NGINX_CONF" ]; then
        grep "allow.*Peer:" "$NGINX_CONF" || log "  (none)"
    fi
    log ""
    log "rspamd connection test:"
    $COMPOSE exec rspamd rspamadm control stat 2>/dev/null | head -5 || log "  rspamd not reachable"
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
        ufw status | grep -E "11333|11335" || log "  (none configured)"
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
        log "Backup created: $BACKUP_FILE"
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
        echo "  first-install            First-time setup on a new VPS"
        echo "  update                   Update to latest version (with backup)"
        echo "  rollback FILE            Rollback database to a backup"
        echo "  backup                   Manual database backup"
        echo "  status                   Show service status"
        echo "  logs [service]           Show logs (e.g. logs postfix)"
        echo ""
        echo "Federation:"
        echo "  federation-add IP [NAME] Add peer (firewall + Nginx)"
        echo "  federation-remove IP     Remove peer"
        echo "  federation-list          Show all peers and status"
        ;;
esac
