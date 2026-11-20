const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const scoreFile = path.join(dataDir, "scores.json");
const port = Number(process.env.PORT || 3000);
const raceRooms = new Map();

const ACTIVE_MS = 3500;    // 多久没上报就视为不在场
const TIMEOUT_MS = 15000;  // 多久后彻底移出房间

function activePlayers(room) {
  const now = Date.now();
  return [...room.players.values()].filter(p => now - p.updatedAt < ACTIVE_MS);
}

function isPlayerActive(room, id) {
  const p = room && id ? room.players.get(id) : null;
  return Boolean(p && (Date.now() - p.updatedAt) < ACTIVE_MS);
}

function isRaceDriving(room) {
  return Boolean(room && room.startAt && Date.now() >= room.startAt && !room.finishAt);
}

function laneStartX(lane) {
  return lane < 0 ? -(20 / 3) : (20 / 3);
}

function resetPlayerForLobby(player) {
  player.ready = false;
  player.finished = false;
  player.x = laneStartX(player.lane);
  player.heading = 0;
  player.speed = 0;
  player.distance = 0;
  player.time = 0;
  player.score = 0;
  player.nitro = 100;
  player.finished = false;
  delete player.finishTime;
  delete player.finishSpeed;
}

function resetRoomToLobby(room) {
  room.startAt = 0;
  room.finishAt = 0;
  if (room.leftSeats) room.leftSeats.clear();
  for (const p of room.players.values()) {
    resetPlayerForLobby(p);
  }
}

function applyHostSettings(room, body) {
  const validThemes = new Set(["country", "island", "jungle", "river"]);
  const validDiffs = new Set(["easy", "normal", "hard"]);
  let changed = false;
  if (body.theme !== undefined && validThemes.has(body.theme) && body.theme !== room.theme) {
    room.theme = body.theme;
    changed = true;
  }
  if (body.difficulty !== undefined && validDiffs.has(body.difficulty) && body.difficulty !== room.difficulty) {
    room.difficulty = body.difficulty;
    changed = true;
  }
  if (body.finishDistance !== undefined) {
    const fd = Number(body.finishDistance);
    if (Number.isFinite(fd) && fd >= 300) {
      const clamped = Math.min(20000, fd);
      if (clamped !== room.finishDistance) {
        room.finishDistance = clamped;
        changed = true;
      }
    }
  }
  if (changed) {
    room.configVersion = (room.configVersion || 1) + 1;
    // 房主修改任意配置后，取消双方准备状态，确保两人都确认最终配置再开始倒计时
    for (const p of room.players.values()) p.ready = false;
  }
  return changed;
}

function scheduleRaceStart(room) {
  const now = Date.now();
  // Reused room codes must start a clean round; otherwise the previous
  // finishAt keeps reporting raceOver to the next pair of players.
  room.finishAt = 0;
  if (room.leftSeats) room.leftSeats.clear();
  for (const player of room.players.values()) {
    resetPlayerForLobby(player);
    player.ready = true;
    player.updatedAt = now;
  }
  room.startAt = now + 3000;
}

function maybeStartCountdown(room) {
  if (!room || room.startAt || room.finishAt) return false;
  const actives = activePlayers(room);
  return actives.length === 2 && actives.every(p => Boolean(p.ready))
    ? (scheduleRaceStart(room), true)
    : false;
}

function buildRoomSyncPayload(room, viewerId) {
  const actives = activePlayers(room);
  const viewer = viewerId ? room.players.get(viewerId) : null;
  const others = actives.filter(p => p.id !== viewerId);
  const pauseInfo = roomPauseInfo(room);
  const finishRemainSec = room.finishAt ? Math.max(0, Math.ceil((10000 - (Date.now() - room.finishAt)) / 1000)) : 0;
  return {
    ok: true,
    isHost: Boolean(viewerId && viewerId === room.hostId),
    hostId: room.hostId || "",
    configVersion: room.configVersion || 1,
    myReady: Boolean(viewer && viewer.ready),
    otherReady: Boolean(others[0] && others[0].ready),
    startAt: room.startAt || 0,
    forceLobbyAt: room.forceLobbyAt || 0,
    serverNow: Date.now(),
    finishDistance: room.finishDistance,
    theme: room.theme || "country",
    difficulty: room.difficulty || "normal",
    playerCount: actives.length,
    raceOver: Boolean(room.finishAt && Date.now() - room.finishAt > 10000),
    finishRemainSec,
    players: others,
    ...pauseInfo
  };
}

function saveLeftSeat(room, player) {
  if (!room || !player || !room.startAt || Date.now() < room.startAt || room.finishAt) return;
  if (!room.leftSeats) room.leftSeats = new Map();
  const snap = { ...player, isHost: player.id === room.hostId };
  room.leftSeats.set(player.id, snap);
  room.leftSeats.set(`name:${String(player.name || "").trim().toLowerCase()}`, snap);
}

function roomPauseInfo() {
  // 对手暂离不暂停正在比赛的车手；其进度保留在 leftSeats，随时重进即可从原位继续
  return { paused: false, pausedReason: "" };
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac"
};

ensureDataFile();

const server = http.createServer(async (request, response) => {
  try {
    // 允许 GitHub Pages 与自建站点跨域调用：回显 Origin，没有 Origin 时用 *
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin || "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      return response.end();
    }
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, service: "neon-racer", time: new Date().toISOString() });
    }

    if (request.method === "GET" && url.pathname === "/api/scores") {
      return sendJson(response, 200, { scores: readScores() });
    }

    if (request.method === "POST" && url.pathname === "/api/scores") {
      const body = await readBody(request);
      const payload = JSON.parse(body || "{}");
      const entry = normalizeScore(payload);
      if (!entry) {
        return sendJson(response, 400, { error: "请输入 1-16 位玩家名，并提交有效用时。" });
      }
      // 同一名字只留最快的一次
      const best = new Map();
      readScores().forEach(item => best.set(String(item.name || "").trim().toLowerCase(), item));
      const key = String(entry.name).trim().toLowerCase();
      const kept = best.get(key);
      if (!kept || Number(entry.time) < Number(kept.time)) best.set(key, entry);
      const scores = [...best.values()]
        .filter(item => String(item.name || "").trim())
        .sort((left, right) => Number(left.time) - Number(right.time))
        .slice(0, 20);
      writeScores(scores);
      return sendJson(response, 201, { saved: entry, scores });
    }

    if (request.method === "POST" && url.pathname === "/api/race/rooms") {
      const body = JSON.parse(await readBody(request) || "{}");
      const name = String(body.name || "车手").slice(0, 16);
      let roomCode = String(body.roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      const action = String(body.action || "join");

      // 手动房号：两人输同一个号就能进，先到的人负责建房间
      if (action === "create" && !roomCode) {
        roomCode = Math.random().toString(36).slice(2, 6).toUpperCase();
      }
      if (action === "join" && roomCode.length < 3) {
        return sendJson(response, 400, { error: "房间号至少 3 位，两人输一样的号就能进同一个房间。" });
      }
      if (action === "create") {
        const finishDistance = Math.max(300, Math.min(20000, Number(body.finishDistance) || 5000));
        const validThemes = new Set(["country", "island", "jungle", "river"]);
        const theme = validThemes.has(body.theme) ? body.theme : "country";
        const validDiffs = new Set(["easy", "normal", "hard"]);
        const difficulty = validDiffs.has(body.difficulty) ? body.difficulty : "normal";
        const existing = raceRooms.get(roomCode);
        if (!existing) {
          raceRooms.set(roomCode, { players: new Map(), leftSeats: new Map(), hostId: "", updatedAt: Date.now(), startAt: 0, finishAt: 0, forceLobbyAt: 0, finishDistance, theme, difficulty, configVersion: 1 });
        } else if (!isRaceDriving(existing) || activePlayers(existing).length === 0) {
          // 只要房间未在行驶或场内已无人，点「创建」清掉残局；若仍有队友在跑则保留赛局以便断点续跑
          for (const [id, p] of existing.players) {
            if (Date.now() - p.updatedAt >= ACTIVE_MS) existing.players.delete(id);
          }
          if (existing.finishAt > 0 || isRaceDriving(existing) || !isPlayerActive(existing, existing.hostId)) {
            resetRoomToLobby(existing);
            existing.forceLobbyAt = Date.now();
            existing.hostId = "";
          }
        }
      }

      const room = raceRooms.get(roomCode);
      if (!room) {
        return sendJson(response, 404, {
          error: action === "join" ? "房间不存在，请让房主先创建这个房间号。" : "房间不存在，请检查房间码。"
        });
      }
      if (!room.leftSeats) room.leftSeats = new Map();
      const nameKey = `name:${name.trim().toLowerCase()}`;
      for (const [id, player] of room.players) {
        if (Date.now() - player.updatedAt > TIMEOUT_MS) {
          saveLeftSeat(room, player);
          room.players.delete(id);
        } else if (!isRaceDriving(room) && Date.now() - player.updatedAt >= ACTIVE_MS) {
          // 大厅阶段直接清理超时离线(>3.5s)占位，避免多开/刷新出现 3 个幽灵座位
          if (room.hostId === id) room.hostId = "";
          room.players.delete(id);
        }
      }
      if (room.finishAt && activePlayers(room).length === 0) {
        room.players.clear();
        room.leftSeats.clear();
        room.startAt = 0;
        room.finishAt = 0;
        room.hostId = "";
      }

      // 支持误退出 / 刷新页面后按原 playerId 或同昵称重连回到当前对局
      const resumeId = String(body.resumePlayerId || "");
      let resumedSeat = (resumeId && room.players.get(resumeId)) || null;
      if (!resumedSeat && (!isRaceDriving(room) || room.players.size >= 2)) {
        resumedSeat = [...room.players.values()].find(p => String(p.name || "").trim().toLowerCase() === name.trim().toLowerCase()) || null;
      }
      if (resumedSeat) {
        resumedSeat.updatedAt = Date.now();
        resumedSeat.name = name;
        room.updatedAt = Date.now();
        const ongoing = isRaceDriving(room);
        if (!ongoing && resumedSeat.id === room.hostId && !room.startAt) {
          applyHostSettings(room, body);
        }
        const sync = buildRoomSyncPayload(room, resumedSeat.id);
        return sendJson(response, 200, {
          ...sync,
          roomCode,
          playerId: resumedSeat.id,
          resumed: ongoing,
          distance: resumedSeat.distance || 0,
          x: Number.isFinite(resumedSeat.x) ? resumedSeat.x : laneStartX(resumedSeat.lane),
          speed: resumedSeat.speed || 0,
          time: resumedSeat.time || 0,
          score: resumedSeat.score || 0,
          nitro: resumedSeat.nitro ?? 100,
          lane: resumedSeat.lane,
          color: resumedSeat.color
        });
      }

      let savedLeft = (resumeId && room.leftSeats.get(resumeId)) || room.leftSeats.get(nameKey) || null;
      if (!savedLeft && room.startAt && Date.now() >= room.startAt && !room.finishAt && room.leftSeats.size > 0 && activePlayers(room).length < 2) {
        savedLeft = Array.from(room.leftSeats.values()).pop() || null;
      }
      if (activePlayers(room).length >= 2) {
        return sendJson(response, 409, { error: "房间已满，先让对方退出房间或等 15 秒掉线后再进。" });
      }
      const playerId = savedLeft ? savedLeft.id : Math.random().toString(36).slice(2, 12);
      if (savedLeft) {
        for (const [k, seat] of room.leftSeats) {
          if (seat && seat.id === savedLeft.id) room.leftSeats.delete(k);
        }
        room.leftSeats.delete(nameKey);
      }
      const hostMissing = !room.hostId || !isPlayerActive(room, room.hostId) || (!room.players.has(room.hostId) && !room.leftSeats.has(room.hostId));
      if (hostMissing && (action === "create" || savedLeft?.isHost || !room.startAt)) {
        room.hostId = playerId;
      }
      // 房主创建/接管未开赛房间时同步其最新赛道、距离与难度设置
      if (playerId === room.hostId && !room.startAt) {
        applyHostSettings(room, body);
      }
      // 起跑车道和车身颜色都由服务器分配，两边看到的是同一套（左右不同车道）
      const occupiedLanes = new Set([...room.players.values()].map(player => player.lane));
      const lane = savedLeft ? savedLeft.lane : (occupiedLanes.has(-1) ? 1 : -1);
      // 颜色只做区分；选相近亮度，避免某个车手更醒目而占视觉优势。
      const color = savedLeft ? savedLeft.color : (lane === -1 ? "#29a3ff" : "#ff9a3c");
      const activeRaceOngoing = isRaceDriving(room);
      room.players.set(playerId, {
        id: playerId,
        name,
        lane,
        color,
        ready: activeRaceOngoing ? true : false,
        x: savedLeft ? (Number.isFinite(savedLeft.x) ? savedLeft.x : laneStartX(lane)) : laneStartX(lane),
        heading: savedLeft ? (savedLeft.heading || 0) : 0,
        speed: savedLeft ? (savedLeft.speed || 0) : 0,
        distance: savedLeft ? (savedLeft.distance || 0) : 0,
        time: savedLeft ? (savedLeft.time || 0) : 0,
        score: savedLeft ? (savedLeft.score || 0) : 0,
        nitro: savedLeft && Number.isFinite(savedLeft.nitro) ? savedLeft.nitro : 100,
        finished: Boolean(savedLeft?.finished),
        updatedAt: Date.now()
      });
      room.updatedAt = Date.now();

      // 进房只落座展示双方车道，绝不直接倒计时；必须等两位车手都确认配置后各自点“准备”才统一倒计时发车
      if (!activeRaceOngoing && !room.finishAt && !room.startAt) {
        room.startAt = 0;
      }
      const sync = buildRoomSyncPayload(room, playerId);

      return sendJson(response, 200, {
        ...sync,
        roomCode, playerId,
        resumed: activeRaceOngoing,
        distance: savedLeft ? (savedLeft.distance || 0) : 0,
        x: savedLeft ? (Number.isFinite(savedLeft.x) ? savedLeft.x : laneStartX(lane)) : laneStartX(lane),
        speed: savedLeft ? (savedLeft.speed || 0) : 0,
        time: savedLeft ? (savedLeft.time || 0) : 0,
        score: savedLeft ? (savedLeft.score || 0) : 0,
        nitro: savedLeft && Number.isFinite(savedLeft.nitro) ? savedLeft.nitro : 100,
        lane,
        color
      });
    }

    if (url.pathname === "/api/race/state" && request.method === "POST") {
      const body = JSON.parse(await readBody(request) || "{}");
      const room = raceRooms.get(String(body.roomCode || "").toUpperCase());
      if (!room || !room.players.has(body.playerId)) return sendJson(response, 404, { error: "联机房间已失效。" });
      const player = room.players.get(body.playerId);
      for (const key of ["x", "heading", "speed", "distance", "time", "score", "nitro"]) {
        player[key] = Number.isFinite(Number(body[key])) ? Number(body[key]) : player[key];
      }
      if (typeof body.finished === "boolean") {
        player.finished = body.finished;
        if (body.finished && !room.finishAt) room.finishAt = Date.now();
        if (body.finished && !player.finishTime) {
          const t = Number(body.time);
          if (Number.isFinite(t) && t > 0) player.finishTime = Math.round(t * 10) / 10;
          const sp = Number(body.speed);
          if (Number.isFinite(sp) && sp > 0) player.finishSpeed = Math.round(sp * 90);
        }
      }
      // 只要未开始倒计时（或上一局已结束等待重开时），房主可随时自由修改主题、距离与难度；更改会重置准备状态
      if (body.playerId === room.hostId && !room.startAt) {
        applyHostSettings(room, body);
      }
      // 先刷新当前车手心跳，再统计在线人数
      player.updatedAt = room.updatedAt = Date.now();
      for (const [id, other] of room.players) {
        if (id !== body.playerId && Date.now() - other.updatedAt > TIMEOUT_MS) {
          saveLeftSeat(room, other);
          room.players.delete(id);
        }
      }
      // 若倒计时中途有车手掉线离开，取消倒计时并重置准备状态
      const activeCount = activePlayers(room).length;
      if (activeCount < 2 && room.startAt && Date.now() < room.startAt) {
        room.startAt = 0;
        for (const p of room.players.values()) p.ready = false;
      }
      // 临时诊断：每 5 秒打印一次房间内每位车手的里程
      if (!room._logAt || Date.now() - room._logAt > 5000) {
        room._logAt = Date.now();
        const roster = [...room.players.values()]
          .map(p => `${p.name}:dist=${Number(p.distance).toFixed(1)},spd=${Number(p.speed).toFixed(2)},rdy=${p.ready ? 1 : 0}`)
          .join(" | ");
        console.log(`[room ${String(body.roomCode || "").toUpperCase()}] players=${room.players.size} startAt=${room.startAt} ${roster}`);
      }
      return sendJson(response, 200, buildRoomSyncPayload(room, body.playerId));
    }

    if (url.pathname === "/api/race/ready" && request.method === "POST") {
      const body = JSON.parse(await readBody(request) || "{}");
      const room = raceRooms.get(String(body.roomCode || "").toUpperCase());
      if (!room || !room.players.has(body.playerId)) return sendJson(response, 404, { error: "联机房间已失效。" });
      const player = room.players.get(body.playerId);
      player.updatedAt = room.updatedAt = Date.now();
      if (!room.startAt && !room.finishAt) {
        player.ready = Boolean(body.ready);
        maybeStartCountdown(room);
      }
      return sendJson(response, 200, buildRoomSyncPayload(room, player.id));
    }

    if (url.pathname === "/api/race/rematch" && request.method === "POST") {
      const body = JSON.parse(await readBody(request) || "{}");
      const room = raceRooms.get(String(body.roomCode || "").toUpperCase());
      if (!room || !room.players.has(body.playerId)) return sendJson(response, 404, { error: "联机房间已失效。" });
      const player = room.players.get(body.playerId);
      player.updatedAt = room.updatedAt = Date.now();
      const forceLobby = Boolean(body.forceLobby);
      const waitingOtherFinish = !forceLobby && Boolean(
        room.finishAt &&
        (Date.now() - room.finishAt) <= 10000 &&
        activePlayers(room).some(p => p.id !== player.id && !p.finished)
      );
      if (waitingOtherFinish) {
        return sendJson(response, 200, { ...buildRoomSyncPayload(room, player.id), waitingOtherFinish: true });
      }
      if (forceLobby || room.startAt > 0 || room.finishAt > 0) {
        resetRoomToLobby(room);
        if (forceLobby) room.forceLobbyAt = Date.now();
        if (!room.hostId || !isPlayerActive(room, room.hostId)) room.hostId = player.id;
        room.configVersion = (room.configVersion || 1) + 1;
      } else {
        resetPlayerForLobby(player);
      }
      return sendJson(response, 200, { ...buildRoomSyncPayload(room, player.id), waitingOtherFinish: false });
    }

    if (url.pathname === "/api/race/state" && request.method === "GET") {
      const room = raceRooms.get(String(url.searchParams.get("roomCode") || "").toUpperCase());
      if (!room) return sendJson(response, 404, { error: "联机房间已失效。" });
      const playerId = url.searchParams.get("playerId");
      return sendJson(response, 200, buildRoomSyncPayload(room, playerId));
    }

    // 退出房间：保留中途误退出的座位快照以便重新加入（并暂停对局等待归队），未发车则取消倒计时并重置准备状态
    if (request.method === "POST" && url.pathname === "/api/race/leave") {
      const body = JSON.parse(await readBody(request) || "{}");
      const code = String(body.roomCode || "").toUpperCase();
      const pid = String(body.playerId || "");
      const room = raceRooms.get(code);
      if (room) {
        const leaving = room.players.get(pid);
        if (leaving) {
          for (const key of ["x", "heading", "speed", "distance", "time", "score", "nitro"]) {
            if (Number.isFinite(Number(body[key]))) leaving[key] = Number(body[key]);
          }
          if (room.startAt && Date.now() >= room.startAt && !room.finishAt) {
            saveLeftSeat(room, leaving);
          } else if (!room.startAt || Date.now() < room.startAt) {
            room.startAt = 0;
            for (const p of room.players.values()) p.ready = false;
          }
          room.players.delete(pid);
          room.updatedAt = Date.now();
        }
      }
      return sendJson(response, 200, { ok: true });
    }

    // 实时推送：SSE，服务端每 40ms 推一次房间内两人的状态，免去客户端轮询延迟
    if (url.pathname === "/api/race/stream" && request.method === "GET") {
      const code = String(url.searchParams.get("roomCode") || "").toUpperCase();
      const viewerId = url.searchParams.get("playerId") || "";
      const room = raceRooms.get(code);
      if (!room) return sendJson(response, 404, { error: "房间不存在" });

      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": request.headers.origin || "*"
      });

      const push = () => {
        const data = buildRoomSyncPayload(room, viewerId);
        try {
          response.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          /* 连接已断开 */
        }
      };
      push();
      const timer = setInterval(push, 40);
      const stop = () => {
        clearInterval(timer);
        try { response.end(); } catch (error) { /* ignore */ }
      };
      request.on("close", stop);
      request.on("error", stop);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    return serveStatic(url.pathname, request, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Neon Racer server running at http://localhost:${port}`);
});

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(scoreFile)) {
    fs.writeFileSync(scoreFile, "[]\n", "utf8");
  }
}

function readScores() {
  try {
    const scores = JSON.parse(fs.readFileSync(scoreFile, "utf8"));
    return Array.isArray(scores) ? scores : [];
  } catch {
    return [];
  }
}

function writeScores(scores) {
  fs.writeFileSync(scoreFile, `${JSON.stringify(scores, null, 2)}\n`, "utf8");
}

function normalizeScore(payload) {
  const name = String(payload.name || "").trim().slice(0, 16);
  // 现在比赛比的是用时（秒），越小越好
  const time = Number(payload.time);
  if (!name || !Number.isFinite(time) || time <= 0 || time > 36000) {
    return null;
  }
  return {
    name,
    time: Math.round(time * 10) / 10,
    createdAt: new Date().toISOString()
  };
}

function serveStatic(urlPath, request, response) {
  const safePath = decodeURIComponent(urlPath.split("?")[0]);
  const target = safePath === "/" ? "/index.html" : safePath;
  const filePath = path.normalize(path.join(rootDir, target));

  if (!filePath.startsWith(rootDir)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      if (path.extname(target)) {
        return sendJson(response, 404, { error: "Not found" });
      }
      fs.readFile(path.join(rootDir, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          return sendJson(response, 404, { error: "Not found" });
        }
        response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
        response.end(fallback);
      });
      return;
    }
    const size = stats.size;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=3600";
    const rangeHeader = request.headers && request.headers.range;

    // 支持 HTTP Range (206 Partial Content) 流式传输，iOS Safari <audio> 必须依赖它才能播放
    if (rangeHeader && size > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : size - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        if (start > end || start >= size) {
          response.writeHead(416, { "Content-Range": `bytes */${size}` });
          return response.end();
        }
        response.writeHead(206, {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl
        });
        if (request.method === "HEAD") return response.end();
        return fs.createReadStream(filePath, { start, end }).pipe(response);
      }
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": size,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl
    });
    if (request.method === "HEAD") return response.end();
    return fs.createReadStream(filePath).pipe(response);
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
