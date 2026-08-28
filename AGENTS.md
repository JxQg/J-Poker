# J-Poker 协作规范

本文件提供 Codex 和贡献者在本仓库工作时需要遵循的项目约定。项目文档记录稳定的功能、接口、配置、运行、发布和维护合同；临时排查过程留在任务记录或持久记忆中。

## 项目定位

J-Poker 是一个 Web 端 2-10 人私人德州扑克小游戏。筹码仅用于娱乐，不涉及账号、支付、现金结算、转让、聊天、观战、机器人或奖品。

项目使用 React、TypeScript、Vite、Zustand、Socket.IO Client、Python 3.12、FastAPI、SQLAlchemy、Alembic、PostgreSQL/SQLite 和 PokerKit 0.7.5。默认部署为前端静态资源与 FastAPI 合并的单容器，NGINX 负责外部 HTTPS 和反向代理。

## 架构边界

- `apps/server` 是房间成员、行动顺序、筹码、牌序、计时器、身份和审计数据的唯一权威；PokerKit 规则只能通过 `PokerKitAdapter` 接入。
- `apps/server/app/actor.py` 按房间串行处理命令；`manager.py` 管理 Actor、连接和广播。不要在前端或 Socket.IO 处理器中复制业务裁决。
- `apps/web` 负责首页、建房、加入、大厅、牌桌、审计展示和连接恢复，不决定下注合法性或权威状态。
- `contracts/protocol.schema.json` 和 `contracts/shuffle-v1-vectors.json` 是提交审查的协议/公平性产物；服务端 Pydantic 模型是协议源，`apps/web/src/generated/protocol.ts` 必须通过生成命令更新。
- `tests/e2e` 覆盖浏览器跨页面流程，`apps/web/src/**/*.test.tsx` 覆盖前端组件/状态，`apps/server/tests` 覆盖后端和规则适配器，`tests/load` 只做负载烟囱验证。

## 稳定业务合同

### 房间和牌局

- 房间码为 8 位 Crockford Base32；玩家通过浏览器安全 Cookie 恢复访客身份。
- 房主直接控制开始第一手，不显示 `ready-toggle`；只有非房主在线玩家在大厅发送 `set_ready` 后，房主才能开始。
- 牌局进行中加入的玩家保留到下一手，未获得本手底牌时不得渲染“你的底牌”区域。
- 结算阶段只有未弃牌、在线、非托管且未申请离房的参与者需要发送 `set_settlement_ready`；全部符合条件的玩家准备后立即进入下一手。
- 断线参与者进入托管状态，主动离房在本手结算后移除；这些状态必须与普通离线、弃牌和等待状态区分。

### 实时协议和数据

- 对外字段使用 camelCase，命令携带 `commandId`、`roomId`、`handId`、`turnId` 和 `expectedVersion`；服务端拒绝过期版本、手牌、回合和非法金额。
- 事件、快照、幂等结果和发件箱在同一数据库事务中提交。客户端只使用当前玩家专属快照，发现版本缺口时请求完整快照。
- PostgreSQL 保存生产事件、快照、幂等结果和审计材料；Redis 不是当前单实例的状态源，也不应仅通过增加 `REDIS_URL` 启用多实例能力。
- 修改 `apps/server/app/protocol.py` 后运行 `pnpm contracts:generate`，检查生成文件差异并一并提交；禁止手工维护第二份 TypeScript 协议。

## 目录速查

- `apps/server/app/`：FastAPI、Socket.IO、RoomActor、领域模型、持久化、指标和公平性实现。
- `apps/server/alembic/`：数据库迁移；生产启动前由入口脚本执行迁移。
- `apps/web/src/components/`：页面和牌桌组件；`src/lib/` 保存协议、Socket、下注和公平性工具；`src/generated/` 为生成代码。
- `tests/e2e/`：Playwright 多浏览器用例；`playwright.config.ts` 定义本地 WebServer、项目矩阵和重试策略。
- `scripts/bootstrap.ps1`、`scripts/dev.ps1`：本地依赖初始化和开发启动入口。
- `infra/Dockerfile.app`、`infra/compose.yaml`、`infra/server-entrypoint.sh`：生产镜像、单服务 Compose 和配置/迁移校验。
- `docs/`：架构、API、安全公平、负载和运维合同；代码变更仅在稳定合同变化时同步文档。

## 本地开发

需要 Python 3.12、Node.js 22 和 pnpm 10。命令从仓库根目录执行：

```powershell
Copy-Item .env.example .env
.\scripts\bootstrap.ps1
.\scripts\dev.ps1
```

开发默认使用 SQLite，前端地址为 `http://localhost:5173`，后端地址为 `http://localhost:8000`。`bootstrap.ps1` 默认不下载浏览器；运行 E2E 前执行：

```powershell
.\scripts\bootstrap.ps1 -InstallBrowsers
```

不要把 `.env`、生产连接串、密钥或真实用户数据提交到仓库。生产必须使用 `postgresql+asyncpg://`、`COOKIE_SECURE=true` 和 `AUTO_CREATE_SCHEMA=false`，并在应用启动前完成 Alembic 迁移。

## 常用命令

外部程序遵循全局 RTK 约定；PowerShell 内建命令直接执行。

```powershell
rtk pnpm install --frozen-lockfile
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test
rtk pnpm contracts:generate
rtk pnpm build
rtk pnpm test:e2e
rtk pnpm --filter @holdem/web test
rtk pnpm --filter @holdem/load-tests load
```

`pnpm test` 同时运行前端 Vitest 和后端 pytest；后端命令通过仓库脚本选择项目虚拟环境。需要单独验证某个浏览器时使用 `rtk pnpm exec playwright test --project=chromium`，不要通过提高超时掩盖角色、状态或协议错误。

## E2E 编写约定

- 共享建局助手只接收非房主页面执行 `ready-toggle`；房主只验证并点击 `start-game`。
- 需要验证下一手的流程必须等待结算可见，再让所有符合结算资格的玩家点击“准备下一手”；不能假设旧的自动续局行为。
- 断言控件前先确认当前页面角色和牌局阶段。房主、非房主、迟加入、托管和弃牌玩家的可见控件不同。
- 牌面隐私断言必须验证本人底牌可见、对手底牌为暗牌，以及迟加入玩家在本手没有空底牌容器。
- UI 角色合同改变时，同时更新共享 Playwright 助手、响应式大厅断言和对应的领域回归测试；至少运行 Chromium E2E。

## 质量门槛

- 前端改动：运行 `pnpm lint:web`、`pnpm --filter @holdem/web typecheck`、相关 Vitest 和 `pnpm build`；布局或流程改动补充桌面/移动端 E2E。
- 后端改动：运行 `pnpm lint`、`pnpm typecheck` 和 `apps/server/tests`；涉及数据库时同时验证迁移和 SQLite/目标 PostgreSQL 的配置边界。
- 协议、规则或公平性改动：运行生成命令，检查生成文件、随机向量和审计验证结果；不得只修改前端类型绕过服务端合同。
- 所有交付前运行 `git diff --check`，检查未跟踪文件和生成文件状态；测试失败必须修复或明确报告，不能删除断言、关闭重试门禁或提交调试产物。

## 发布与部署

- `.github/workflows/ci.yml` 在合并前执行 lint、类型检查、单测、协议生成校验、Web 构建、镜像构建和四浏览器 E2E；不要把 CI 的浏览器安装问题当作应用编译错误。
- `.github/workflows/release-images.yml` 只由 `v*` Git 标签触发，向 GHCR 推送单一 `j-poker` 镜像及版本、次版本、SHA 和 `latest` 标签。
- 生产通过 `infra/compose.yaml` 运行单个 `j-poker` 服务并绑定 `127.0.0.1:8000`；部署前校验 Compose 配置、镜像、数据库连接、密钥、HTTPS Origin 和迁移权限。
- 当前单实例不配置 Redis、不在 Compose 中创建 PostgreSQL，也不通过应用启动隐式执行生产 DDL；扩展多实例必须同时设计房间归属、Socket.IO 广播、限流和互斥。
- 发布或升级后检查 `/health/live`、`/health/ready`、静态资源、SPA 路由、Socket.IO 连接和审计下载；不要复用已知存在前端启动异常的旧镜像标签。

## 变更原则

- 先检索调用点、协议源和现有测试，再修改共享状态、命令、事件或配置。
- 保持现有行为和外部合同；不为临时兼容复制协议、业务规则或常量。
- 不使用宽泛异常捕获、静默成功、客户端伪造状态或绕过服务端校验的测试替代实现。
- 保留用户已有改动和未相关文件；不执行破坏性 Git 操作，不自动提交、推送或发布。
