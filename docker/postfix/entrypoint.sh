#!/bin/bash
set -e

# Set hostname
if [ -n "$PROXY_HOSTNAME" ]; then
    postconf -e "myhostname=$PROXY_HOSTNAME"
fi

# Configure PostgreSQL lookup credentials for domain routing
PGUSER="${POSTGRES_USER:-spamproxy}"
PGPASS="${POSTGRES_PASSWORD:-changeme}"
PGDB="${POSTGRES_DB:-spamproxy}"
PGHOST="${POSTGRES_HOST:-postgres}"

for cf in /etc/postfix/pgsql-transport.cf /etc/postfix/pgsql-relay-domains.cf; do
    sed -i \
        -e "s/POSTGRES_USER_PLACEHOLDER/$PGUSER/" \
        -e "s/POSTGRES_PASSWORD_PLACEHOLDER/$PGPASS/" \
        -e "s/POSTGRES_DB_PLACEHOLDER/$PGDB/" \
        -e "s/^hosts = .*/hosts = $PGHOST/" \
        "$cf"
    chmod 640 "$cf"
    chown root:postfix "$cf"
done

# Generate self-signed cert if none exists
if [ ! -f /etc/ssl/certs/postfix.pem ]; then
    openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
        -subj "/CN=${PROXY_HOSTNAME:-proxy.example.com}" \
        -keyout /etc/ssl/private/postfix.key \
        -out /etc/ssl/certs/postfix.pem
    chmod 600 /etc/ssl/private/postfix.key
fi

# Create required directories
mkdir -p /var/spool/postfix/pid
chown -R postfix:postfix /var/spool/postfix
mkdir -p /var/log/postfix

echo "Postfix configured with PostgreSQL domain routing (host=$PGHOST, db=$PGDB)"
exec "$@"
