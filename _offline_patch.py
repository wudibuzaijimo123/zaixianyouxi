import io, re

# ---------- game.js ----------
p = "D:/playcargame-offline/game.js"
t = io.open(p, encoding="utf-8").read()

# 1) 离线开关
if "const OFFLINE_MODE" not in t:
    t = t.replace("const api = {", "// 离线版：所有网络请求直接禁用\nconst OFFLINE_MODE = true;\n\nconst api = {", 1)

# 2) 请求短路
old = "  async request(path, options) {"
assert old in t
if "离线版不联网" not in t:
    t = t.replace(old, old + '\n    if (OFFLINE_MODE) throw new Error("离线版不联网");', 1)

# 3) 榜单改成读本地
old_load = '''async function loadLeaderboard() {
  try {
    const data = await api.get("/api/scores");
    setServerState(true);
    renderLeaderboard(data.scores || []);
  } catch (error) {
    setServerState(false);
    leaderboardList.innerHTML = "<li>服务器未连接，当前记录本机分数。</li>";
  }
}'''
new_load = '''function readLocalScores() {
  try {
    const data = JSON.parse(localStorage.getItem("racerLocalScores") || "[]");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function saveLocalScore(name, time) {
  const list = readLocalScores();
  const key = String(name || "车手").trim().toLowerCase();
  const kept = list.filter(item => String(item.name || "").trim().toLowerCase() !== key);
  kept.push({ name: name || "车手", time: Math.round(time * 10) / 10, createdAt: new Date().toISOString() });
  kept.sort((a, b) => Number(a.time) - Number(b.time));
  localStorage.setItem("racerLocalScores", JSON.stringify(kept.slice(0, 20)));
}

function loadLeaderboard() {
  renderLeaderboard(readLocalScores());
  setServerState(false);
}'''
assert old_load in t
t = t.replace(old_load, new_load, 1)

# 4) 冲线只存本地
old_post = '''  api.post("/api/scores", { name: playerName, time: raceTime })
    .then(() => loadLeaderboard())
    .catch(() => {});'''
assert old_post in t
t = t.replace(old_post, '  saveLocalScore(playerName, raceTime);\n  loadLeaderboard();', 1)

# 5) 房间相关入口直接挡掉
old_enter = "async function enterRaceRoom(rawCode) {"
t = t.replace(old_enter, old_enter + '\n  if (OFFLINE_MODE) return;', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(t)
print("game.js ok", "OFFLINE_MODE" in t, "saveLocalScore" in t)

# ---------- index.html ----------
h = "D:/playcargame-offline/index.html"
hx = io.open(h, encoding="utf-8").read()

for frag in [
    '        <button id="createRoom" type="button">进入房间</button>\n',
    '        <button id="leaveRoom" type="button">退出房间</button>\n',
    '        <div><input id="roomCodeInput" maxlength="8" placeholder="输入房间号，两人输一样的"><button id="joinRoom" type="button">进入</button></div>\n',
]:
    hx = hx.replace(frag, "")

hx = hx.replace("<div id=\"roomStatus\">单人比赛</div>", '<div id="roomStatus" style="display:none">单人比赛</div>')
hx = hx.replace("game.js?v=43", "game.js?v=offline-1")
io.open(h, "w", encoding="utf-8", newline="\n").write(hx)
print("index ok", "createRoom" not in hx, "offline-1" in hx)
