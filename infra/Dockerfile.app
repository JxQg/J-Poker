FROM node:22-alpine AS web-builder

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY tests/load/package.json ./tests/load/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
COPY contracts ./contracts
RUN pnpm --filter @holdem/web build

FROM python:3.12-slim AS server-builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv

RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /build/server
COPY apps/server/pyproject.toml ./
COPY apps/server/app ./app
RUN python -m pip install --upgrade pip && python -m pip install .

FROM python:3.12-slim AS runtime

ENV APP_ENV=production \
    AUTO_CREATE_SCHEMA=false \
    COOKIE_SECURE=true \
    WEB_DIST_DIR=/app/web \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --system holdem && useradd --system --gid holdem --home-dir /app holdem

WORKDIR /app
COPY --from=server-builder /opt/venv /opt/venv
COPY --chown=holdem:holdem apps/server/alembic.ini ./apps/server/alembic.ini
COPY --chown=holdem:holdem apps/server/alembic ./apps/server/alembic
COPY --chown=holdem:holdem apps/server/app ./apps/server/app
COPY --from=web-builder --chown=holdem:holdem /workspace/apps/web/dist ./web
COPY --chown=holdem:holdem THIRD_PARTY_NOTICES.md ./web/THIRD_PARTY_NOTICES.md
COPY --chown=holdem:holdem infra/server-entrypoint.sh /usr/local/bin/server-entrypoint
RUN chmod 0555 /usr/local/bin/server-entrypoint

USER holdem
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=2).read()"]

ENTRYPOINT ["server-entrypoint"]
CMD ["python", "-m", "uvicorn", "app.main:socket_app", "--app-dir", "apps/server", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
