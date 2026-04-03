#!/bin/bash
# Called by Sieve imapsieve when a message is moved TO the Junk folder.
# Learns the message as spam via rspamd.
#
# Dovecot config needed:
#   plugin {
#     sieve_plugins = sieve_imapsieve sieve_extprograms
#     imapsieve_mailbox1_name = Junk
#     imapsieve_mailbox1_causes = COPY APPEND
#     imapsieve_mailbox1_before = file:/etc/dovecot/sieve/learn-spam.sieve
#     imapsieve_mailbox2_name = *
#     imapsieve_mailbox2_from = Junk
#     imapsieve_mailbox2_causes = COPY
#     imapsieve_mailbox2_before = file:/etc/dovecot/sieve/learn-ham.sieve
#     sieve_pipe_bin_dir = /etc/dovecot/sieve
#   }

RSPAMD_URL="${RSPAMD_URL:-http://localhost:11334}"
RSPAMD_PASSWORD="${RSPAMD_PASSWORD:-}"

HEADERS=""
[ -n "$RSPAMD_PASSWORD" ] && HEADERS="-H Password:${RSPAMD_PASSWORD}"

exec curl -s -o /dev/null \
    -X POST "${RSPAMD_URL}/learnspam" \
    --data-binary @- \
    $HEADERS \
    --max-time 30
