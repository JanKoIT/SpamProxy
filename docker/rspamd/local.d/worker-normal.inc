# Normal worker - handles actual scanning requests from proxy (port 11332)
# and accepts encrypted connections from remote scanner clients.
bind_socket = "*:11333";
count = 4;
max_tasks = 0;
