# Dovecot IMAPSieve Spam/Ham Learning

Automatically trains rspamd when users move messages to/from the Junk folder in their email client.

## How it works

- **Move to Junk** → `learn-spam.sh` → rspamd `learnspam`
- **Move from Junk** → `learn-ham.sh` → rspamd `learnham`

## Installation on Dovecot Server

### 1. Copy files

```bash
sudo mkdir -p /etc/dovecot/sieve
sudo cp learn-spam.sh learn-ham.sh /etc/dovecot/sieve/
sudo cp learn-spam.sieve learn-ham.sieve /etc/dovecot/sieve/
sudo chmod +x /etc/dovecot/sieve/learn-spam.sh /etc/dovecot/sieve/learn-ham.sh
```

### 2. Set rspamd URL

Edit the `.sh` files and set `RSPAMD_URL` to your SpamProxy rspamd controller:

```bash
# If Dovecot runs on the same server as SpamProxy:
RSPAMD_URL="http://localhost:11334"

# If SpamProxy is on a different server:
RSPAMD_URL="http://spamproxy-server:11334"
```

If rspamd has a password set:
```bash
RSPAMD_PASSWORD="your-rspamd-password"
```

### 3. Compile Sieve scripts

```bash
sudo sievec /etc/dovecot/sieve/learn-spam.sieve
sudo sievec /etc/dovecot/sieve/learn-ham.sieve
```

### 4. Configure Dovecot

Add to `/etc/dovecot/conf.d/90-sieve.conf` or `/etc/dovecot/conf.d/20-imap.conf`:

```
protocol imap {
  mail_plugins = $mail_plugins imap_sieve
}

plugin {
  sieve_plugins = sieve_imapsieve sieve_extprograms

  # Learn spam when moved to Junk
  imapsieve_mailbox1_name = Junk
  imapsieve_mailbox1_causes = COPY APPEND
  imapsieve_mailbox1_before = file:/etc/dovecot/sieve/learn-spam.sieve

  # Learn ham when moved from Junk
  imapsieve_mailbox2_name = *
  imapsieve_mailbox2_from = Junk
  imapsieve_mailbox2_causes = COPY
  imapsieve_mailbox2_before = file:/etc/dovecot/sieve/learn-ham.sieve

  sieve_pipe_bin_dir = /etc/dovecot/sieve
  sieve_global_extensions = +vnd.dovecot.pipe +vnd.dovecot.environment
}
```

### 5. Restart Dovecot

```bash
sudo systemctl restart dovecot
```

### 6. Test

Move a message to Junk in your email client, then check:

```bash
# Check rspamd learned count
curl http://localhost:11334/stat | jq '.learned'
```

## Alternative: Cron-based Learning

If you can't install imapsieve (e.g. shared hosting), use the cron-based learner instead:

```bash
# Install on the Dovecot server
cp /opt/spamproxy/scripts/dovecot-learn.sh /usr/local/bin/

# Run every 2 hours
crontab -e
0 */2 * * * /usr/local/bin/dovecot-learn.sh \
  --url http://spamproxy:8025 \
  --mail-dir /var/vmail \
  --max-age 7 \
  --learn-ham \
  >> /var/log/spamproxy-learn.log 2>&1
```
