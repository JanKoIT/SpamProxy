FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    postfix \
    postfix-pcre \
    postfix-pgsql \
    libsasl2-modules \
    sasl2-bin \
    ca-certificates \
    supervisor \
    socat \
    && rm -rf /var/lib/apt/lists/*

COPY main.cf /etc/postfix/main.cf
COPY master.cf /etc/postfix/master.cf
COPY header_checks.pcre /etc/postfix/header_checks.pcre
COPY pgsql-transport.cf /etc/postfix/pgsql-transport.cf
COPY pgsql-relay-domains.cf /etc/postfix/pgsql-relay-domains.cf
COPY queue-api.sh /queue-api.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /queue-api.sh

EXPOSE 25 587

ENTRYPOINT ["/entrypoint.sh"]
CMD ["postfix", "start-fg"]
