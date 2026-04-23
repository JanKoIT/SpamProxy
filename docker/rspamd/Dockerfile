FROM rspamd/rspamd:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends socat python3 && rm -rf /var/lib/apt/lists/*
COPY keypair-api.sh /keypair-api.sh
COPY entrypoint.sh /entrypoint.sh
COPY milter-healthcheck.py /milter-healthcheck.py
RUN chmod +x /keypair-api.sh /entrypoint.sh /milter-healthcheck.py
# Entrypoint runs as root (writes to override.d), then drops to _rspamd
ENTRYPOINT ["/entrypoint.sh"]
