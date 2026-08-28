import { randomBytes, randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const integerEnv = (name, fallback, minimum, maximum) => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
};

const booleanEnv = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be true or false`);
};

const config = {
  baseUrl: (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
  origin: (process.env.LOAD_ORIGIN ?? "http://localhost:5173").replace(/\/$/, ""),
  rooms: integerEnv("LOAD_ROOMS", 100, 1, 1_000),
  usersPerRoom: integerEnv("LOAD_USERS_PER_ROOM", 10, 2, 10),
  durationSeconds: integerEnv("LOAD_DURATION_SECONDS", 1_800, 5, 86_400),
  rampConcurrency: integerEnv("LOAD_RAMP_CONCURRENCY", 10, 1, 100),
  actionTimeoutSeconds: integerEnv("LOAD_ACTION_TIMEOUT_SECONDS", 15, 15, 60),
  autoPlay: booleanEnv("LOAD_AUTO_PLAY", true),
  closeRooms: booleanEnv("LOAD_CLOSE_ROOMS", true),
  maxErrorRate: Number.parseFloat(process.env.LOAD_MAX_ERROR_RATE ?? "0.02"),
  maxP95Ms: integerEnv("LOAD_MAX_P95_MS", 200, 1, 60_000),
};
const origin = new URL(config.origin).origin;

if (![15, 30, 60].includes(config.actionTimeoutSeconds)) {
  throw new Error("LOAD_ACTION_TIMEOUT_SECONDS must be 15, 30, or 60");
}
if (!Number.isFinite(config.maxErrorRate) || config.maxErrorRate < 0 || config.maxErrorRate > 1) {
  throw new Error("LOAD_MAX_ERROR_RATE must be between 0 and 1");
}

const stats = {
  startedAt: Date.now(),
  apiRequests: 0,
  apiErrors: 0,
  connected: 0,
  reconnects: 0,
  snapshots: 0,
  events: 0,
  versionRegressions: 0,
  accepted: 0,
  rejected: 0,
  commandErrors: 0,
  ackLatencies: [],
};
const liveUsers = new Set();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const percentile = (values, percentage) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percentage) - 1)];
};

const waitFor = async (predicate, timeoutMs, message) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(message);
};

class HttpSession {
  cookie = "";

  async request(path, init = {}) {
    stats.apiRequests += 1;
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Origin: origin,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...init.headers,
      },
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";", 1)[0];
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      stats.apiErrors += 1;
      throw new Error(`${init.method ?? "GET"} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  }
}

class VirtualUser {
  constructor(roomIndex, userIndex, identity, http) {
    this.roomIndex = roomIndex;
    this.userIndex = userIndex;
    this.identity = identity;
    this.http = http;
  }

  socket = undefined;
  snapshot = undefined;
  lastVersion = -1;
  handledEntropyHands = new Set();
  handledTurns = new Set();
  automationBusy = false;

  async connect() {
    const ticket = await this.http.request(
      `/api/v1/rooms/${encodeURIComponent(this.identity.roomId)}/socket-ticket`,
      { method: "POST", body: "{}" },
    );

    await new Promise((resolve, reject) => {
      const socket = io(config.baseUrl, {
        path: "/socket.io",
        auth: { ticket: ticket.ticket },
        extraHeaders: {
          Origin: origin,
          ...(this.http.cookie ? { Cookie: this.http.cookie } : {}),
        },
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 250,
        reconnectionDelayMax: 2_000,
        timeout: 10_000,
      });
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error(`Socket connection timed out for room ${this.roomIndex}`));
      }, 12_000);
      socket.once("connect", () => {
        clearTimeout(timer);
        stats.connected += 1;
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.io.on("reconnect", () => {
        stats.reconnects += 1;
      });
      socket.on("room:snapshot", (snapshot) => this.onSnapshot(snapshot));
      socket.on("room:event", (event) => {
        stats.events += 1;
        if (event?.snapshot) this.onSnapshot(event.snapshot);
      });
      socket.on("room:error", () => {
        stats.commandErrors += 1;
      });
    });

    await waitFor(() => Boolean(this.snapshot), 10_000, "Initial room snapshot was not received");
    liveUsers.add(this);
  }

  onSnapshot(snapshot) {
    if (!snapshot || typeof snapshot.version !== "number") return;
    stats.snapshots += 1;
    if (snapshot.version < this.lastVersion) stats.versionRegressions += 1;
    this.lastVersion = Math.max(this.lastVersion, snapshot.version);
    this.snapshot = snapshot;
    if (config.autoPlay) void this.automate();
  }

  async automate() {
    if (this.automationBusy || !this.snapshot) return;
    const snapshot = this.snapshot;
    const hand = snapshot.hand;
    const memberId = snapshot.you?.memberId;
    const player = snapshot.players?.find((candidate) => candidate.memberId === memberId);

    if (
      snapshot.phase === "collecting_entropy" &&
      hand?.handId &&
      player?.status !== "sitting_out" &&
      !this.handledEntropyHands.has(hand.handId)
    ) {
      this.handledEntropyHands.add(hand.handId);
      this.automationBusy = true;
      try {
        await this.command("contribute_randomness", {
          entropy: randomBytes(32).toString("base64url"),
        });
      } catch {
        this.handledEntropyHands.delete(hand.handId);
      } finally {
        this.automationBusy = false;
      }
      return;
    }

    if (
      snapshot.phase !== "playing" ||
      !hand?.turnId ||
      hand.actorMemberId !== memberId ||
      this.handledTurns.has(hand.turnId)
    ) return;

    const legal = hand.legalActions ?? {};
    const action = legal.canCheck
      ? "check"
      : legal.canCall
        ? "call"
        : legal.canFold
          ? "fold"
          : undefined;
    if (!action) {
      throw new Error(`No legal action projected for turn ${hand.turnId}`);
    }
    this.handledTurns.add(hand.turnId);
    this.automationBusy = true;
    try {
      await this.command("player_action", { action });
    } catch {
      this.handledTurns.delete(hand.turnId);
    } finally {
      this.automationBusy = false;
    }
  }

  async command(type, payload = {}) {
    if (!this.socket?.connected || !this.snapshot) throw new Error("Socket is not ready");
    const snapshot = this.snapshot;
    const command = {
      commandId: randomUUID(),
      roomId: snapshot.roomId,
      handId: snapshot.hand?.handId ?? null,
      turnId: snapshot.hand?.turnId ?? null,
      expectedVersion: snapshot.version,
      type,
      payload,
    };
    const startedAt = performance.now();
    let ack;
    try {
      ack = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Command ${type} timed out`)), 10_000);
        this.socket.emit("room:command", command, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    } catch (error) {
      stats.commandErrors += 1;
      throw error;
    }
    stats.ackLatencies.push(performance.now() - startedAt);
    if (ack?.status === "accepted") stats.accepted += 1;
    else stats.rejected += 1;
    if (ack?.status !== "accepted") {
      throw new Error(`${type} rejected: ${ack?.errorCode ?? "UNKNOWN"}`);
    }
    await waitFor(
      () => (this.snapshot?.version ?? -1) >= ack.appliedVersion,
      5_000,
      `Snapshot did not reach version ${ack.appliedVersion}`,
    );
    return ack;
  }

  disconnect() {
    this.socket?.disconnect();
    liveUsers.delete(this);
  }
}

const mapConcurrent = async (values, concurrency, operation) => {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const createRoom = async (roomIndex) => {
  const users = [];
  const hostHttp = new HttpSession();
  const hostIdentity = await hostHttp.request("/api/v1/rooms", {
    method: "POST",
    body: JSON.stringify({
      nickname: `load-r${roomIndex}-u0`,
      config: {
        maxPlayers: config.usersPerRoom,
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 2_000,
        actionTimeoutSeconds: config.actionTimeoutSeconds,
      },
    }),
  });
  const host = new VirtualUser(roomIndex, 0, hostIdentity, hostHttp);
  await host.connect();
  users.push(host);

  const guests = await Promise.all(
    Array.from({ length: config.usersPerRoom - 1 }, async (_, offset) => {
      const userIndex = offset + 1;
      const http = new HttpSession();
      const identity = await http.request(
        `/api/v1/rooms/${encodeURIComponent(hostIdentity.roomCode)}/join`,
        {
          method: "POST",
          body: JSON.stringify({ nickname: `load-r${roomIndex}-u${userIndex}` }),
        },
      );
      const user = new VirtualUser(roomIndex, userIndex, identity, http);
      await user.connect();
      return user;
    }),
  );
  users.push(...guests);

  for (const user of users) await user.command("set_ready", { ready: true });
  await host.command("start_hand");
  return { host, users };
};

const report = (rooms) => {
  const commands = stats.accepted + stats.rejected + stats.commandErrors;
  const errorRate = commands === 0 ? 0 : (stats.rejected + stats.commandErrors) / commands;
  const summary = {
    configuredRooms: config.rooms,
    configuredUsers: config.rooms * config.usersPerRoom,
    activeRooms: rooms.length,
    connected: stats.connected,
    reconnects: stats.reconnects,
    apiRequests: stats.apiRequests,
    apiErrors: stats.apiErrors,
    snapshots: stats.snapshots,
    events: stats.events,
    acceptedCommands: stats.accepted,
    rejectedCommands: stats.rejected,
    commandErrors: stats.commandErrors,
    versionRegressions: stats.versionRegressions,
    ackP50Ms: Math.round(percentile(stats.ackLatencies, 0.5)),
    ackP95Ms: Math.round(percentile(stats.ackLatencies, 0.95)),
    ackP99Ms: Math.round(percentile(stats.ackLatencies, 0.99)),
    errorRate: Number(errorRate.toFixed(4)),
    elapsedSeconds: Math.round((Date.now() - stats.startedAt) / 1_000),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
};

const main = async () => {
  process.stdout.write(
    `Starting ${config.rooms} rooms x ${config.usersPerRoom} users for ${config.durationSeconds}s against ${config.baseUrl}\n`,
  );
  const rooms = [];
  try {
    const roomIndexes = Array.from({ length: config.rooms }, (_, index) => index);
    rooms.push(...await mapConcurrent(roomIndexes, config.rampConcurrency, createRoom));
    const expectedConnections = config.rooms * config.usersPerRoom;
    if (stats.connected !== expectedConnections) {
      throw new Error(`Connected ${stats.connected} of ${expectedConnections} virtual users`);
    }

    await sleep(config.durationSeconds * 1_000);

    if (config.closeRooms) {
      await Promise.allSettled(rooms.map(({ host }) => host.command("close_room")));
      await sleep(1_000);
    }
    const summary = report(rooms);
    if (summary.versionRegressions > 0) throw new Error("Snapshot versions regressed");
    if (summary.errorRate > config.maxErrorRate) {
      throw new Error(`Command error rate ${summary.errorRate} exceeded ${config.maxErrorRate}`);
    }
    if (summary.ackP95Ms > config.maxP95Ms) {
      throw new Error(`ACK p95 ${summary.ackP95Ms}ms exceeded ${config.maxP95Ms}ms`);
    }
  } finally {
    for (const user of [...liveUsers]) user.disconnect();
  }
};

main().catch((error) => {
  stats.commandErrors += 1;
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
