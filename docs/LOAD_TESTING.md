# 负载测试

`tests/load/load.mjs` 通过公开 REST 和 Socket.IO 接口创建独立游客会话，不直接访问数据库。每个玩家使用独立 Cookie 和一次性票据；房间准备后自动开局，并持续提交随机贡献及 `check`、`call` 或 `fold` 合法动作。

默认验收目标为 100 个房间、每房 10 人、持续 30 分钟：

```powershell
$env:LOAD_BASE_URL = 'https://poker.example.com'
pnpm --filter @holdem/load-tests load
```

目标规模会从同一压测机发起超过生产默认值的创建、加入和票据请求。只能在隔离的预发布环境把 `RATE_LIMIT_CREATE_PER_MINUTE`、`RATE_LIMIT_JOIN_PER_MINUTE` 和 `RATE_LIMIT_TICKET_PER_MINUTE` 提高到至少 `1000`；公网生产环境不得为压测关闭限流。

本地烟测可降低规模：

```powershell
$env:LOAD_ROOMS = '2'
$env:LOAD_USERS_PER_ROOM = '2'
$env:LOAD_DURATION_SECONDS = '15'
$env:LOAD_MAX_P95_MS = '1000'
pnpm --filter @holdem/load-tests load
```

可配置项：

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `LOAD_ROOMS` | `100` | 房间数 |
| `LOAD_USERS_PER_ROOM` | `10` | 每房玩家数，范围 2-10 |
| `LOAD_DURATION_SECONDS` | `1800` | 达到目标连接数后的持续时间 |
| `LOAD_RAMP_CONCURRENCY` | `10` | 并发创建房间数 |
| `LOAD_AUTO_PLAY` | `true` | 自动贡献随机数并行动 |
| `LOAD_CLOSE_ROOMS` | `true` | 测试结束后请求关闭房间 |
| `LOAD_MAX_ERROR_RATE` | `0.02` | 命令拒绝与错误率上限 |
| `LOAD_MAX_P95_MS` | `200` | 命令 ACK p95 上限，毫秒 |

测试在连接数不足、快照版本回退、错误率或 ACK p95 超标时返回非零状态。报告只包含数量和延迟，不记录 Cookie、票据、随机贡献或牌面。
