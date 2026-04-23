#!/usr/bin/env python3
"""Milter protocol healthcheck.

Performs an SMFIC_OPTNEG handshake against the local rspamd milter port.
Exits 0 if rspamd responds correctly, 1 if hung or unreachable.

This is stricter than a plain TCP check: the milter worker can accept
connections while the scanner backend is hung, which causes Postfix to
see 'can't read SMFIC_OPTNEG reply packet header: Connection timed out'.
"""
import socket
import struct
import sys


def main() -> int:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect(("127.0.0.1", 11332))
        # SMFIC_OPTNEG: 'O' + version(6) + actions(0x1FF) + protocol(0x3FFFFF)
        payload = b"O" + struct.pack(">III", 6, 0x1FF, 0x3FFFFF)
        s.sendall(struct.pack(">I", len(payload)) + payload)
        hdr = s.recv(4)
        if len(hdr) != 4:
            return 1
        reply_len = struct.unpack(">I", hdr)[0]
        if reply_len == 0 or reply_len > 1024:
            return 1
        reply = s.recv(reply_len)
        s.close()
        return 0 if reply[:1] == b"O" else 1
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
