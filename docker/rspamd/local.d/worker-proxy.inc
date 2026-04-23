# Milter proxy worker - accepts Postfix milter connections on 11332
# and dispatches scan requests to normal-worker pool on 11333.
#
# Running multiple proxy workers (count=4) lets us accept new OPTNEG
# handshakes while existing connections are scanning. self_scan=yes
# was the previous setup but created a single-worker bottleneck.
bind_socket = "*:11332";
milter = yes;
timeout = 30s;
count = 4;
max_retries = 2;
# Dont reject - only add headers. Content filter decides.
reject_message = "";
discard_on_reject = false;
quarantine_on_reject = false;
upstream "default" {
    default = yes;
    hosts = "127.0.0.1:11333";
}
