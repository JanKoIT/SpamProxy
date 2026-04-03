require ["vnd.dovecot.pipe", "copy", "imapsieve", "environment", "variables"];

if environment :matches "imap.cause" "*" {
    # Message moved from Junk to another folder -> learn as ham
    pipe :copy "learn-ham.sh";
}
