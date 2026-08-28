# Server

The server is authoritative for room membership, action order, chip accounting,
timeouts, private card projections, and audit records. PokerKit 0.7.5 owns all
No-Limit Texas Hold'em betting and payout rules behind `PokerKitAdapter`.

From the repository root, create the environment and start the development
server:

```powershell
python -m venv apps/server/.venv
apps/server/.venv/Scripts/python -m pip install -e "apps/server[dev]"
apps/server/.venv/Scripts/python -m uvicorn app.main:socket_app --app-dir apps/server --host 127.0.0.1 --port 8000
```

Development defaults to `sqlite+aiosqlite:///./.data/poker.db` and creates the
schema automatically. Production requires PostgreSQL, HTTPS cookies, an
explicit 32-byte `APP_SECRET_KEY`, disabled automatic schema creation, and an
Alembic migration before startup:

```powershell
apps/server/.venv/Scripts/python -m alembic -c apps/server/alembic.ini upgrade head
```

Socket.IO uses the default namespace and `/socket.io` path. Clients emit
`room:command`; the server emits `room:snapshot`, `room:event`, `room:ack`, and
`room:error`. A socket connection requires a single-use ticket obtained from
`POST /api/v1/rooms/{roomId}/socket-ticket`.

