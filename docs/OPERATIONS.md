# 运行与部署

## 本地开发

需要 Python 3.12、Node.js 22 和 pnpm 10。

```powershell
Copy-Item .env.example .env
./scripts/bootstrap.ps1
./scripts/dev.ps1
```

前端默认访问 `http://localhost:5173`，后端默认访问 `http://localhost:8000`。本地默认使用 SQLite；生产验收必须使用 PostgreSQL。

房间日志保留最近 80 条基础动态和最近 20 手结算。每手结算后，房间成员可查看全部底牌、公共牌、PokerKit 牌型结果与该手积分变化；筹码不超过当前大盲的玩家可在结算期或等待状态主动借入一份固定初始积分，并从下一手恢复入座。下一手仅接纳筹码严格高于大盲的在线、已准备玩家。积分榜按当前筹码减累计借款积分排名。

手动点击测试不依赖 Playwright。只有运行 `pnpm test:e2e` 前才需要执行 `./scripts/bootstrap.ps1 -InstallBrowsers` 下载 Chromium。

常用检查：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:generate
pnpm build
pnpm test:e2e
```

## 生产部署

生产机需要 Docker Engine、Compose v2、既有 NGINX HTTPS 域名配置，以及可访问既有 PostgreSQL 的网络。应用只发布本机回环端口 `127.0.0.1:8000`，不占用 `80` 或 `443`。

部署前复制 `infra/production.env.example` 为服务器上的 `.env`，将 `JP_IMAGE`、`SITE_ADDRESS`、`DATABASE_URL` 和 `APP_SECRET_KEY` 替换为真实值。`DATABASE_URL` 必须使用 `postgresql+asyncpg://`，且数据库账号拥有该应用库的迁移权限。

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
docker compose --env-file .env -f infra/compose.yaml config
docker login ghcr.io
docker compose --env-file .env -f infra/compose.yaml pull
docker compose --env-file .env -f infra/compose.yaml up -d
docker compose --env-file .env -f infra/compose.yaml ps
```

私有 GHCR 包需要服务器使用具有 `read:packages` 权限的 GitHub token 登录。启动入口先校验生产配置，再执行 Alembic 迁移。`APP_SECRET_KEY` 必须是至少 32 字节的 URL-safe Base64，`ALLOWED_ORIGINS` 固定为 `https://SITE_ADDRESS`，生产环境强制安全 Cookie 且禁止自动建表。

既有 NGINX 将域名请求反代至 `http://127.0.0.1:8000`。`infra/nginx.j-poker.example.conf` 仅供核对 `Host`、`X-Forwarded-*` 和 Socket.IO WebSocket Upgrade 头，不需要替换已有证书或 HTTPS 配置。

当前版本没有自动排空接口。升级需安排维护窗口，先确认没有活跃房间，再重建服务；单实例版本不支持在牌局中切换规则版本。

## 健康检查

- `/health/live`：进程存活。
- `/health/ready`：数据库和运行依赖可用。
- Compose 的健康检查访问容器内的 `/health/live`；既有 NGINX 可将 `/health/ready` 用作上游探测。

## PostgreSQL 与 Redis

PostgreSQL 由服务器现有实例负责备份、恢复、账号与网络策略。本项目 Compose 不会创建数据库、执行 `pg_dump`，也不会覆盖已有数据库。

当前单实例不接入 Redis：房间 Actor、Socket.IO 广播和限流均在同一个应用进程中。即使服务器已有 Redis，也不要配置 `REDIS_URL`，因为当前版本不会读取它。扩展到多应用容器时，Redis 才会与 Socket.IO 消息管理、房间归属、分布式限流和互斥一起接入。

Redis 版本对当前发布没有要求；将来多实例接入时，使用受支持的稳定 Redis 版本并隔离逻辑数据库、账号和 ACL 即可。
