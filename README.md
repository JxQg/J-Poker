# J-Poker

Web 端 2-10 人私人德州扑克小游戏。房主创建房间，其他玩家通过 8 位房间码加入；服务端权威裁决牌局，支持连续多手、断线恢复、边池、手动借款积分和房间结束后的公平性审计。

本项目只使用无现实价值、不可转让的娱乐筹码，不提供账号、支付、排行榜、聊天、观战、锦标赛、机器人、奖品或现金结算。

## 快速开始

需要 Python 3.12、Node.js 22 和 pnpm 10。

```powershell
Copy-Item .env.example .env
./scripts/bootstrap.ps1
./scripts/dev.ps1
```

打开 `http://localhost:5173`。默认配置为小盲/大盲 `10/20`、初始筹码 `2000`、行动时间 30 秒。

`bootstrap.ps1` 只安装应用运行依赖。需要运行浏览器 E2E 测试时，再执行 `./scripts/bootstrap.ps1 -InstallBrowsers`。

## 工程命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:generate
pnpm build
pnpm test:e2e
```

## 文档

- [系统架构](docs/ARCHITECTURE.md)
- [接口契约](docs/API.md)
- [运行与部署](docs/OPERATIONS.md)
- [安全与公平](docs/SECURITY_AND_FAIRNESS.md)
- [负载测试](docs/LOAD_TESTING.md)

生产环境将 Web 与 FastAPI 打包为单个 GHCR 镜像，通过 `DATABASE_URL` 接入既有 PostgreSQL；部署入口见 `infra/compose.yaml`。既有 NGINX 继续负责 HTTPS，并反代至容器绑定的 `127.0.0.1:8000`。

## 许可

本项目自有源代码采用 [MIT License](LICENSE) 发布。MIT 许可仅适用于本项目拥有版权的源代码和文档，不改变第三方组件的原有许可。

第三方依赖、字体及其版权声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，使用和再分发时应遵守各自许可条款。项目名称 `J-Poker`、Logo、图标及其他品牌标识不因 MIT 许可获得商标或品牌授权。
