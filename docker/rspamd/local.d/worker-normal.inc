# Normal worker - handles scanning requests
# Also accepts encrypted connections from remote scanner clients
bind_socket = "*:11333";
count = 4;

# Include scanner client keypairs (generated via web interface)
.try_include "/etc/rspamd/keypairs/scanner-keypairs.conf"
