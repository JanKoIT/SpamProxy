require ["vnd.dovecot.pipe", "copy", "imapsieve", "environment", "variables"];

if environment :matches "imap.cause" "*" {
    # Message moved/copied to Junk folder -> learn as spam
    pipe :copy "learn-spam.sh";
}
