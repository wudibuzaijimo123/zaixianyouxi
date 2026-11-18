import io

p = "D:/playcargame/index.html"
t = io.open(p, encoding="utf-8").read()

# 1) 小地图画布（左上角）
mini = '  <canvas id="minimap" style="position:fixed;z-index:12;border-radius:12px;background:rgba(8,16,28,.58);border:1px solid rgba(97,239,255,.25);pointer-events:none;"></canvas>\n\n'
if 'id="minimap"' not in t:
    anchor = '  <section class="hud">'
    t = t.replace(anchor, mini + anchor, 1)

# 2) 退出房间按钮
old_btn = '<button id="createRoom" type="button">进入房间</button>'
new_btn = '<button id="createRoom" type="button">进入房间</button>\n        <button id="leaveRoom" type="button">退出房间</button>'
if 'id="leaveRoom"' not in t:
    t = t.replace(old_btn, new_btn, 1)

# 3) 版本号
t = t.replace("game.js?v=37", "game.js?v=38")
t = t.replace("style.css?v=20", "style.css?v=38")

io.open(p, "w", encoding="utf-8", newline="\n").write(t)
print("minimap", 'id="minimap"' in t, "leave", 'id="leaveRoom"' in t, "v38", "v=38" in t)
print("CJK", sum(1 for c in t if "\u4e00" <= c <= "\u9fff"))
