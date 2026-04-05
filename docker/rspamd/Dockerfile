FROM rspamd/rspamd:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*
COPY keypair-api.sh /keypair-api.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /keypair-api.sh /entrypoint.sh
USER _rspamd
ENTRYPOINT ["/entrypoint.sh"]
