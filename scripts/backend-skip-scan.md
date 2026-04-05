# Backend Server: Skip rspamd scan for SpamProxy-scanned mails

When SpamProxy sits in front of your mail server, mails get scanned twice:
once by SpamProxy's rspamd, and again by the backend's rspamd.

This guide configures the backend to skip scanning for mails already
scanned by SpamProxy, while still using the spam headers for sorting.

## Option A: Postfix milter exemption (recommended)

On the **backend Postfix**, skip the milter for mails coming from SpamProxy:

```bash
# /etc/postfix/main.cf
# Only apply milter to mails NOT from SpamProxy
smtpd_milter_maps = cidr:/etc/postfix/milter_map.cidr
```

Create `/etc/postfix/milter_map.cidr`:
```
# SpamProxy IP - skip milter (already scanned)
SPAMPROXY_IP/32    DISABLE

# All other sources - use rspamd milter
0.0.0.0/0          inet:localhost:11332
```

Replace `SPAMPROXY_IP` with your SpamProxy server IP, then:
```bash
postfix reload
```

## Option B: rspamd settings module

On the **backend rspamd**, add a settings rule to skip scanning for
mails that already have SpamProxy headers:

Create `/etc/rspamd/local.d/settings.conf`:
```
spamproxy_scanned {
    priority = 10;
    request_header = {
        "X-Spamd-Result" = "/.*SpamProxy.*/";
    }
    apply {
        actions {
            reject = 9999.0;
            "add header" = 9999.0;
        }
        symbols_disabled = ["*"];
    }
}
```

This disables all scanning for mails that already have an X-Spamd-Result
header from SpamProxy.

## Option C: Dovecot Sieve sorting (works with both options above)

Whether or not the backend rspamd scans, Dovecot can use the SpamProxy
headers to sort mails into Junk:

Create `/etc/dovecot/sieve/spam-to-junk.sieve`:
```sieve
require ["fileinto", "imap4flags"];

# Sort based on SpamProxy headers
if header :contains "X-Spam-Status" "Yes" {
    fileinto "Junk";
    stop;
}

# Alternative: check X-Spam header
if header :is "X-Spam" "Yes" {
    fileinto "Junk";
    stop;
}
```

Compile and activate:
```bash
sievec /etc/dovecot/sieve/spam-to-junk.sieve
```

Add to Dovecot config (`/etc/dovecot/conf.d/90-sieve.conf`):
```
plugin {
    sieve_before = /etc/dovecot/sieve/spam-to-junk.sieve
}
```

```bash
systemctl restart dovecot
```

## Verification

Send a test mail through SpamProxy. On the backend, check:
```bash
# Mail should have these SpamProxy headers:
grep -i "X-Spamd-Result\|X-Spam-Status\|X-Rspamd" /var/mail/user/new/*
```

The headers contain the score and symbols from SpamProxy's scan.
Dovecot sieve uses these to sort into Inbox or Junk.
