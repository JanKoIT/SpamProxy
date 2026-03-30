"""
Dovecot-compatible SASL auth server for Postfix.

Postfix connects to this via TCP and speaks the Dovecot auth protocol.
We verify credentials against the smtp_credentials table.

Protocol: https://doc.dovecot.org/configuration_manual/authentication/auth_protocol/
"""

import asyncio
import logging

from sqlalchemy import select, text
from .db import async_session
from .quarantine.models import SmtpCredential

logger = logging.getLogger(__name__)


class DovecotAuthServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 12345):
        self.host = host
        self.port = port

    async def start(self):
        server = await asyncio.start_server(
            self._handle_client, self.host, self.port
        )
        logger.info("Dovecot SASL auth server listening on %s:%d", self.host, self.port)
        async with server:
            await server.serve_forever()

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        addr = writer.get_extra_info("peername")
        logger.debug("SASL auth connection from %s", addr)

        try:
            # Send server handshake
            # VERSION\tMAJOR\tMINOR
            # MECH\tPLAIN\tplaintext
            # SPID\t<pid>
            # CUID\t<counter>
            # DONE
            writer.write(b"VERSION\t1\t2\n")
            writer.write(b"MECH\tPLAIN\tplaintext\n")
            writer.write(b"SPID\t1\n")
            writer.write(b"CUID\t1\n")
            writer.write(b"DONE\n")
            await writer.drain()

            while True:
                line = await reader.readline()
                if not line:
                    break

                line = line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                parts = line.split("\t")
                cmd = parts[0]

                if cmd == "VERSION":
                    # Client version, just acknowledge
                    continue
                elif cmd == "CPID":
                    # Client PID, just acknowledge
                    continue
                elif cmd == "AUTH":
                    await self._handle_auth(parts, writer)
                else:
                    logger.debug("Unknown SASL command: %s", cmd)

        except asyncio.IncompleteReadError:
            pass
        except Exception:
            logger.exception("SASL auth error")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _handle_auth(self, parts: list[str], writer: asyncio.StreamWriter):
        # AUTH\t<id>\tPLAIN\t...params...
        # Look for resp= parameter with base64 PLAIN credentials
        request_id = parts[1] if len(parts) > 1 else "0"

        resp_data = None
        for part in parts:
            if part.startswith("resp="):
                resp_data = part[5:]

        if not resp_data:
            writer.write(f"FAIL\t{request_id}\treason=missing credentials\n".encode())
            await writer.drain()
            return

        try:
            import base64
            decoded = base64.b64decode(resp_data).decode("utf-8", errors="replace")
            # PLAIN format: \0username\0password
            null_parts = decoded.split("\0")
            if len(null_parts) == 3:
                # authzid, authcid, password
                username = null_parts[1]
                password = null_parts[2]
            elif len(null_parts) == 2:
                username = null_parts[0]
                password = null_parts[1]
            else:
                writer.write(f"FAIL\t{request_id}\treason=invalid PLAIN data\n".encode())
                await writer.drain()
                return

            if await self._verify_credentials(username, password):
                logger.info("SASL auth success for user: %s", username)
                writer.write(f"OK\t{request_id}\tuser={username}\n".encode())
            else:
                logger.warning("SASL auth failed for user: %s", username)
                writer.write(f"FAIL\t{request_id}\treason=invalid credentials\n".encode())

            await writer.drain()

        except Exception:
            logger.exception("SASL auth decode error")
            writer.write(f"FAIL\t{request_id}\treason=internal error\n".encode())
            await writer.drain()

    async def _verify_credentials(self, username: str, password: str) -> bool:
        try:
            async with async_session() as session:
                result = await session.execute(
                    select(SmtpCredential).where(
                        SmtpCredential.username == username,
                        SmtpCredential.is_active.is_(True),
                    )
                )
                cred = result.scalar_one_or_none()
                if not cred:
                    return False

                verify_result = await session.execute(
                    text("SELECT :hash = crypt(:password, :hash) AS valid"),
                    {"hash": cred.password_hash, "password": password},
                )
                return verify_result.one().valid
        except Exception:
            logger.exception("Credential verification error")
            return False


async def start_sasl_server():
    server = DovecotAuthServer(host="0.0.0.0", port=12345)
    await server.start()
