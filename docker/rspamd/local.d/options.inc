# Load custom Lua plugins
lua = "/etc/rspamd/local.d/lua_custom.lua";

# Use dedicated Unbound DNS resolver
dns {
    nameserver = ["unbound:53"];
    timeout = 2s;
    retransmits = 2;
    # Cap cache so DNS failures dont pile up forever
    sockets = 16;
}

# Keep scan timeout short enough that hung workers get recycled
# instead of piling up behind a stuck DNS/RBL lookup.
task_timeout = 25s;
