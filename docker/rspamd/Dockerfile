FROM rspamd/rspamd:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*
COPY keypair-api.sh /keypair-api.sh
RUN chmod +x /keypair-api.sh
USER _rspamd
CMD sh -c "socat TCP-LISTEN:11336,reuseaddr,fork EXEC:/keypair-api.sh & exec /usr/bin/rspamd -f"
