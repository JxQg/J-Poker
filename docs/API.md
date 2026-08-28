# 接口契约

所有字段使用 camelCase，筹码使用非负整数。完整类型以 `contracts/protocol.schema.json` 为准；前端类型由该文件生成，不手工维护第二份协议。

## REST

### 创建房间

`POST /api/v1/rooms`

```json
{
  "nickname": "Player 1",
  "config": {
    "maxPlayers": 10,
    "smallBlind": 10,
    "bigBlind": 20,
    "initialStack": 2000,
    "actionTimeoutSeconds": 30
  }
}
```

成功返回 `201` 和 `{ "roomId", "roomCode", "memberId" }`。

### 加入房间

`POST /api/v1/rooms/{roomCode}/join`，请求体为 `{ "nickname": "Player 2" }`，成功返回 `{ "roomId", "roomCode", "memberId" }`。

创建和加入接口设置 `holdem_guest` 身份 Cookie。浏览器后续请求必须携带 Cookie；服务端忽略客户端自行声明的玩家身份。

### 实时票据

`POST /api/v1/rooms/{roomId}/socket-ticket` 返回 `{ "ticket", "expiresAt" }`。票据 30 秒有效且只能消费一次，通过 Socket.IO `auth.ticket` 提交。

### 审计包

`GET /api/v1/rooms/{roomId}/audit` 只允许房间成员访问，并仅在房间关闭后返回签名审计包。

### 健康检查

- `GET /health/live`：进程存活，返回 `{ "status": "ok" }`。
- `GET /health/ready`：数据库可用时返回 `200` 和 `{ "status": "ready" }`，否则返回 `503`。
- `/api/v1/health/live` 和 `/api/v1/health/ready` 提供等价响应。

REST 业务错误返回 `{ "errorCode", "message" }`。生产环境的状态变更请求必须携带配置允许的 `Origin`。

## Socket.IO

路径为 `/socket.io`，默认 namespace。连接成功后服务端发送当前玩家专属的 `room:snapshot`，其中只有该玩家可见的底牌。

客户端通过 `room:command` 提交命令，并使用 Socket.IO ACK 回调接收结果：

```json
{
  "commandId": "6ebc4b72-9d36-4e7a-88a0-f51fc80bc754",
  "roomId": "room-uuid",
  "handId": null,
  "turnId": null,
  "expectedVersion": 3,
  "type": "set_ready",
  "payload": { "ready": true }
}
```

接受结果为 `{ "status": "accepted", "commandId", "appliedVersion" }`；拒绝结果额外包含 `errorCode` 和 `message`。服务端同时发送 `room:ack`，拒绝时发送 `room:error`。

状态变化先发送连续版本的 `room:event`，随后向每个在线成员发送各自的 `room:snapshot`。客户端发现版本缺口时发送 `request_snapshot`，服务端重新推送私有快照。

除同一手牌的随机贡献外，命令必须匹配当前 `expectedVersion`、`handId` 和 `turnId`。随机贡献允许版本落后于其他玩家已经提交的贡献，但仍严格校验手牌、回合和成员唯一性。
