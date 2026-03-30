# Fuzzy storage worker - stores and serves fuzzy hashes
bind_socket = "*:11335";
count = 1;
backend = "redis";
expire = 90d;

# Allow learning from local network (Docker)
allow_update = "127.0.0.0/8,172.16.0.0/12,10.0.0.0/8";
