bind_socket = "*:11332";
milter = yes;
timeout = 120s;
# Nie ablehnen - nur Header hinzufügen. Content Filter entscheidet.
reject_message = "";
discard_on_reject = false;
quarantine_on_reject = false;
upstream "local" {
    default = yes;
    self_scan = yes;
}
