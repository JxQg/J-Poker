#!/bin/sh
set -eu

if [ "${APP_ENV:-}" = "production" ]; then
  python - <<'PY'
import base64
import os
import re
from urllib.parse import urlsplit


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required in production")
    return value


database_url = require("DATABASE_URL")
if not database_url.startswith("postgresql+asyncpg://"):
    raise SystemExit("DATABASE_URL must use postgresql+asyncpg in production")
parsed_database = urlsplit(database_url.replace("postgresql+asyncpg", "postgresql", 1))
if not parsed_database.hostname or not parsed_database.path.strip("/"):
    raise SystemExit("DATABASE_URL must include a database host and name")

secret = require("APP_SECRET_KEY")
if secret == "ZGV2ZWxvcG1lbnQtb25seS1ob2xkZW0tc2VjcmV0LWtleS0wMDAx":
    raise SystemExit("APP_SECRET_KEY must not use the development value")
if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", secret):
    raise SystemExit("APP_SECRET_KEY must be URL-safe base64")
try:
    decoded_secret = base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4))
except (ValueError, base64.binascii.Error) as exc:
    raise SystemExit("APP_SECRET_KEY must be URL-safe base64") from exc
if len(decoded_secret) < 32:
    raise SystemExit("APP_SECRET_KEY must decode to at least 32 bytes")

origins = [item.strip() for item in require("ALLOWED_ORIGINS").split(",") if item.strip()]
if not origins or any(not origin.startswith("https://") for origin in origins):
    raise SystemExit("ALLOWED_ORIGINS must contain only HTTPS origins in production")
if os.environ.get("COOKIE_SECURE", "").lower() not in {"1", "true", "yes", "on"}:
    raise SystemExit("COOKIE_SECURE must be true in production")
if os.environ.get("AUTO_CREATE_SCHEMA", "").lower() not in {"0", "false", "no", "off"}:
    raise SystemExit("AUTO_CREATE_SCHEMA must be false in production")
PY
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  python -m alembic -c apps/server/alembic.ini upgrade head
fi

exec "$@"
