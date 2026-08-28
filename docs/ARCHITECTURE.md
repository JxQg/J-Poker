# 系统架构

本项目采用单实例模块化单体，支持 2-10 人私人房和连续多手牌局。浏览器只连接既有 NGINX 暴露的 HTTPS 入口；REST、Socket.IO 和打包后的 Web 静态资源均由同一个 FastAPI 应用容器提供。

```text
Browser -> NGINX HTTPS -> J-Poker container (127.0.0.1:8000) -> FastAPI / Socket.IO -> RoomActor -> PokerKit
                                                                                              -> PostgreSQL
```

## 运行边界

- `apps/web` 负责创建、加入、大厅、牌桌和审计界面，不裁决下注是否合法。
- `apps/server` 是房间、计时器、筹码、牌序和身份的唯一权威。
- 每个房间由一个 `RoomActor` 串行处理命令，避免玩家动作与超时并发修改同一状态。
- PostgreSQL 保存事件、快照、幂等结果、发件箱和加密审计材料；数据库不可用时房间停止推进。
- PokerKit 通过内部适配层接入，版本升级必须重放既有规则夹具。

## 一致性契约

实时命令携带 `commandId`、`roomId`、`handId`、`turnId` 和 `expectedVersion`。服务端按 `commandId` 幂等，并拒绝旧手牌、旧回合、旧版本和非法金额。

事件、快照、幂等结果和发件箱在同一数据库事务中提交。客户端只收到按当前玩家裁剪的私有快照；版本不连续时重新请求完整快照，不能用客户端缓存推断权威状态。

## 容量边界

当前部署目标为单实例 100 个活跃房间、800 条 Socket.IO 连接。达到该容量前不接入 Redis 或微服务：RoomActor、Socket.IO 广播和限流均有意保持在单进程内。扩展到多实例前，必须一起实现 Redis Socket.IO 消息管理、跨实例房间归属、分布式限流与互斥，不能只添加 `REDIS_URL`。
