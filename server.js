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

function scheduleRaceStart(room) {
  const now = Date.now();
  // Reused room codes must start a clean round; otherwise the previous
  // finishAt keeps reporting raceOver to the next pair of players.
  room.finishAt = 0;
  for (const player of room.players.values()) {
    player.x = 0;
    player.heading = 0;
    player.speed = 0;
    player.distance = 0;
    player.finished = false;
    delete player.finishTime;
    delete player.finishSpeed;
    player.updatedAt = now;
  }
  room.startAt = now + 4000;
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
  ".wav": "audio/wav"
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
        const finishDistance = Math.max(300, Math.min(20000, Number(body.finishDistance) || 1500));
        const validThemes = new Set(["country", "island", "jungle", "river"]);
        const theme = validThemes.has(body.theme) ? body.theme : "country";
        const validDiffs = new Set(["easy", "normal", "hard"]);
        const difficulty = validDiffs.has(body.difficulty) ? body.difficulty : "normal";
        const existing = raceRooms.get(roomCode);
        if (!existing) {
          raceRooms.set(roomCode, { players: new Map(), leftSeats: new Map(), hostId: "", updatedAt: Date.now(), startAt: 0, finishDistance, theme, difficulty });
        }
      }

      const room = raceRooms.get(roomCode);
      if (!room) {
        return sendJson(response, 404, {
          error: action === "join" ? "房间不存在，请让房主先创建这个房间号。" : "房间不存在，请检查房间码。"
        });
      }
      if (!room.leftSeats) room.leftSeats = new Map();
      for (const [id, player] of room.players) {
        if (Date.now() - player.updatedAt > TIMEOUT_MS) {
          if (room.startAt && Date.now() >= room.startAt && !room.finishAt) {
            room.leftSeats.set(id, { ...player, isHost: id === room.hostId });
            room.leftSeats.set(`name:${String(player.name || "").trim().toLowerCase()}`, { ...player, isHost: id === room.hostId });
          }
          room.players.delete(id);
        }
      }

      // 支持误退出 / 刷新页面后按原 playerId 或同昵称重连回到当前对局
      const resumeId = String(body.resumePlayerId || "");
      const nameKey = `name:${name.trim().toLowerCase()}`;
      let resumedSeat = (resumeId && room.players.get(resumeId)) || null;
      if (!resumedSeat && room.players.size >= 2) {
        resumedSeat = [...room.players.values()].find(p => String(p.name || "").trim().toLowerCase() === name.trim().toLowerCase()) || null;
      }
      if (resumedSeat) {
        resumedSeat.updatedAt = Date.now();
        resumedSeat.name = name;
        room.updatedAt = Date.now();
        return sendJson(response, 200, {
          roomCode,
          playerId: resumedSeat.id,
          isHost: resumedSeat.id === room.hostId,
          resumed: Boolean(room.startAt && Date.now() >= room.startAt),
          distance: resumedSeat.distance || 0,
          x: resumedSeat.x || 0,
          startAt: room.startAt || 0,
          serverNow: Date.now(),
          finishDistance: room.finishDistance,
          theme: room.theme || "country",
          difficulty: room.difficulty || "normal",
          playerCount: activePlayers(room).length,
          lane: resumedSeat.lane,
          color: resumedSeat.color
        });
      }

      const savedLeft = (resumeId && room.leftSeats.get(resumeId)) || room.leftSeats.get(nameKey) || null;
      if (activePlayers(room).length >= 2) {
        return sendJson(response, 409, { error: "房间已满，先让对方退出房间或等 15 秒掉线后再进。" });
      }
      const playerId = savedLeft ? savedLeft.id : Math.random().toString(36).slice(2, 12);
      if (savedLeft) {
        room.leftSeats.delete(savedLeft.id);
        room.leftSeats.delete(nameKey);
      }
      if (!room.hostId && (action === "create" || savedLeft?.isHost)) {
        room.hostId = playerId;
      }
      // 起跑车道和车身颜色都由服务器分配，两边看到的是同一套
      const occupiedLanes = new Set([...room.players.values()].map(player => player.lane));
      const lane = savedLeft ? savedLeft.lane : (occupiedLanes.has(-1) ? 1 : -1);
      // 颜色只做区分；选相近亮度，避免某个车手更醒目而占视觉优势。
      const color = savedLeft ? savedLeft.color : (lane === -1 ? "#29a3ff" : "#ff9a3c");
      room.players.set(playerId, {
        id: playerId,
        name,
        lane,
        color,
        x: savedLeft ? (savedLeft.x || 0) : 0,
        heading: savedLeft ? (savedLeft.heading || 0) : 0,
        speed: savedLeft ? (savedLeft.speed || 0) : 0,
        distance: savedLeft ? (savedLeft.distance || 0) : 0,
        finished: Boolean(savedLeft?.finished),
        updatedAt: Date.now()
      });
      room.updatedAt = Date.now();

      // 两人到齐 → 安排统一起跑时刻（4 秒倒计时），双方同时归零起步（若对局已在进行则直接恢复）
      const activeCount = activePlayers(room).length;
      if (!savedLeft || !room.startAt) {
        if (activeCount < 2) {
          room.startAt = 0;   // 只有一个人在房间里：绝不开赛
        } else if (!room.startAt) {
          scheduleRaceStart(room);
        }
      }

      return sendJson(response, 200, {
        roomCode, playerId,
        isHost: playerId === room.hostId,
        resumed: Boolean(savedLeft && room.startAt && Date.now() >= room.startAt),
        distance: savedLeft ? (savedLeft.distance || 0) : 0,
        x: savedLeft ? (savedLeft.x || 0) : 0,
        startAt: room.startAt || 0,
        serverNow: Date.now(),
        finishDistance: room.finishDistance,
        theme: room.theme || "country",
        difficulty: room.difficulty || "normal",
        playerCount: activePlayers(room).length,
        lane,
        color
      });
    }

    if (url.pathname === "/api/race/state" && request.method === "POST") {
      const body = JSON.parse(await readBody(request) || "{}");
      const room = raceRooms.get(String(body.roomCode || "").toUpperCase());
      if (!room || !room.players.has(body.playerId)) return sendJson(response, 404, { error: "联机房间已失效。" });
      const player = room.players.get(body.playerId);
      for (const key of ["x", "heading", "speed", "distance"]) player[key] = Number.isFinite(Number(body[key])) ? Number(body[key]) : player[key];
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
      // 只有房主在发车前可以切换房间赛道主题和难度
      const validThemes = new Set(["country", "island", "jungle", "river"]);
      const validDiffs = new Set(["easy", "normal", "hard"]);
      if (body.playerId === room.hostId && (!room.startAt || Date.now() < room.startAt)) {
        if (validThemes.has(body.theme)) room.theme = body.theme;
        if (validDiffs.has(body.difficulty)) room.difficulty = body.difficulty;
      }
      // 先刷新当前车手心跳，再统计在线人数，避免刚恢复连接时用旧时间误判房间人数。
      player.updatedAt = room.updatedAt = Date.now();
      for (const [id, other] of room.players) {
        if (id !== body.playerId && Date.now() - other.updatedAt > 15000) room.players.delete(id);
      }
      // 只有两位车手都在上报心跳时才安排统一倒计时；发车前有人离开就取消。
      const activeCount = activePlayers(room).length;
      if (activeCount >= 2) {
        if (!room.startAt) scheduleRaceStart(room);
      } else if (room.startAt && Date.now() < room.startAt) {
        room.startAt = 0;
      }
      // 临时诊断：每 5 秒打印一次房间内每位车手的里程，用于定位"原地不动"
      if (!room._logAt || Date.now() - room._logAt > 5000) {
        room._logAt = Date.now();
        const roster = [...room.players.values()]
          .map(p => `${p.name}:dist=${Number(p.distance).toFixed(1)},spd=${Number(p.speed).toFixed(2)}`)
          .join(" | ");
        console.log(`[room ${String(body.roomCode || "").toUpperCase()}] players=${room.players.size} startAt=${room.startAt} ${roster}`);
      }
      return sendJson(response, 200, {
        ok: true,
        startAt: room.startAt || 0,
        serverNow: Date.now(),
        finishDistance: room.finishDistance,
        theme: room.theme || "country",
        difficulty: room.difficulty || "normal",
        playerCount: activeCount,
        raceOver: Boolean(room.finishAt && Date.now() - room.finishAt > 5000),
        // 只返回仍在上报心跳的对手，离线车手不冒充仍在房间。
        players: activePlayers(room).filter(p => p.id !== body.playerId)
      });
    }

    if (url.pathname === "/api/race/state" && request.method === "GET") {
      const room = raceRooms.get(String(url.searchParams.get("roomCode") || "").toUpperCase());
      if (!room) return sendJson(response, 404, { error: "联机房间已失效。" });
      const playerId = url.searchParams.get("playerId");
      return sendJson(response, 200, {
        players: activePlayers(room).filter(player => player.id !== playerId),
        startAt: room.startAt || 0,
        serverNow: Date.now(),
        finishDistance: room.finishDistance,
        theme: room.theme || "country",
        difficulty: room.difficulty || "normal",
        playerCount: activePlayers(room).length
      });
    }

    // 退出房间：保留中途误退出的座位快照以便重新加入，未发车则重置倒计时
    if (request.method === "POST" && url.pathname === "/api/race/leave") {
      const body = JSON.parse(await readBody(request) || "{}");
      const code = String(body.roomCode || "").toUpperCase();
      const pid = String(body.playerId || "");
      const room = raceRooms.get(code);
      if (room) {
        const leaving = room.players.get(pid);
        if (leaving && room.startAt && Date.now() >= room.startAt && !room.finishAt) {
          if (!room.leftSeats) room.leftSeats = new Map();
          const snap = { ...leaving, isHost: pid === room.hostId };
          room.leftSeats.set(pid, snap);
          room.leftSeats.set(`name:${String(leaving.name || "").trim().toLowerCase()}`, snap);
        } else if (!room.startAt || Date.now() < room.startAt) {
          room.startAt = 0;
        }
        room.players.delete(pid);
        room.updatedAt = Date.now();
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
        const players = activePlayers(room).filter(p => p.id !== viewerId);
        const data = {
          players,
          startAt: room.startAt || 0,
          serverNow: Date.now(),
          finishDistance: room.finishDistance,
          theme: room.theme || "country",
          difficulty: room.difficulty || "normal",
          playerCount: activePlayers(room).length,
          raceOver: Boolean(room.finishAt && Date.now() - room.finishAt > 5000)
        };
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

    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    return serveStatic(url.pathname, response);
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

function serveStatic(urlPath, response) {
  const safePath = decodeURIComponent(urlPath.split("?")[0]);
  const target = safePath === "/" ? "/index.html" : safePath;
  const filePath = path.normalize(path.join(rootDir, target));

  if (!filePath.startsWith(rootDir)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(rootDir, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          return sendJson(response, 404, { error: "Not found" });
        }
        response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
        response.end(fallback);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(content);
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
