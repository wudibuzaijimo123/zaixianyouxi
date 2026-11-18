import io

# ============ game.js ============
p = "D:/playcargame/game.js"
t = io.open(p, encoding="utf-8").read()

# 1) 可配置按键
if "const DEFAULT_KEYMAP" not in t:
    anchor = "const keys = {};"
    assert anchor in t
    block = '''const keys = {};

// ── 可自定义快捷键（默认：W 油门 / S 刹车 / Shift 加速 / ←→ 转向）──
const KEYMAP_STORAGE = "racerKeymap";
const DEFAULT_KEYMAP = {
  throttle: "KeyW",
  brake: "KeyS",
  boost: "ShiftLeft",
  left: "ArrowLeft",
  right: "ArrowRight"
};
const KEY_LABELS = {
  KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D", KeyQ: "Q", KeyE: "E",
  Space: "空格", ShiftLeft: "左 Shift", ShiftRight: "右 Shift",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  KeyJ: "J", KeyK: "K", KeyL: "L", KeyU: "U", KeyI: "I", KeyO: "O",
  Digit1: "1", Digit2: "2", Digit3: "3", Enter: "回车", Tab: "Tab"
};
let keymap = Object.assign({}, DEFAULT_KEYMAP);
try {
  Object.assign(keymap, JSON.parse(localStorage.getItem(KEYMAP_STORAGE) || "{}"));
} catch (error) { /* 忽略损坏的配置 */ }
let capturingKey = null;

function keyLabel(code) {
  return KEY_LABELS[code] || String(code || "").replace("Key", "");
}

function saveKeymap() {
  localStorage.setItem(KEYMAP_STORAGE, JSON.stringify(keymap));
}

function renderKeymapButtons() {
  ["throttle", "brake", "boost", "left", "right"].forEach(action => {
    const btn = document.querySelector(`#key-${action}`);
    if (btn && capturingKey !== action) btn.textContent = keyLabel(keymap[action]);
  });
}

function startKeyCapture(action) {
  capturingKey = action;
  const btn = document.querySelector(`#key-${action}`);
  if (btn) btn.textContent = "按新键…";
}'''
    t = t.replace(anchor, block, 1)

# 2) 速度/氮气/刹车/转向改为读 keymap
t = t.replace(
    '  const accelerating = keys.KeyW || keys.ArrowUp || keys.throttle;',
    '  const accelerating = keys[keymap.throttle] || keys.ArrowUp || keys.throttle;', 1)
t = t.replace(
    '  const wantsBoost = (keys.Space || keys.boost) && nitro > 0;',
    '  const wantsBoost = (keys[keymap.boost] || keys.ShiftLeft || keys.ShiftRight || keys.boost) && nitro > 0;', 1)
t = t.replace(
    '  const braking = brakeHeld || keys.brake || keys.KeyS || keys.ArrowDown;',
    '  const braking = brakeHeld || keys.brake || keys[keymap.brake] || keys.ArrowDown;', 1)
t = t.replace(
    '  const turnLeft = steeringMode === "buttons" && (keys.ArrowLeft || keys.KeyA || keys.left);',
    '  const turnLeft = steeringMode === "buttons" && (keys[keymap.left] || keys.ArrowLeft || keys.KeyA || keys.left);', 1)
t = t.replace(
    '  const turnRight = steeringMode === "buttons" && (keys.ArrowRight || keys.KeyD || keys.right);',
    '  const turnRight = steeringMode === "buttons" && (keys[keymap.right] || keys.ArrowRight || keys.KeyD || keys.right);', 1)

# 3) 键盘重点：录制模式优先
old_keydown = '''window.addEventListener("keydown", event => {
  unlockAudioAndHaptics();
  keys[event.code] = true;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});'''
new_keydown = '''window.addEventListener("keydown", event => {
  unlockAudioAndHaptics();
  if (capturingKey) {
    event.preventDefault();
    keymap[capturingKey] = event.code;
    saveKeymap();
    capturingKey = null;
    renderKeymapButtons();
    return;
  }
  keys[event.code] = true;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});'''
assert old_keydown in t
t = t.replace(old_keydown, new_keydown, 1)

# 4) 减少晕眩：弯道变缓 + 相机更稳 + FOV 不再猛变
t = t.replace('[0.32, 34]', '[0.32, 20]', 1)
t = t.replace('[0.44, 34]', '[0.44, 20]', 1)
t = t.replace('[0.50, 18]', '[0.50, 11]', 1)
t = t.replace('[0.62, -34]', '[0.62, -20]', 1)
t = t.replace('[0.72, -34]', '[0.72, -20]', 1)

t = t.replace('  camera.position.x += (targetCamX - camera.position.x) * 0.35;',
              '  camera.position.x += (targetCamX - camera.position.x) * 0.16;', 1)
t = t.replace('  const targetFov = boosting ? 68 : 58;',
              '  const targetFov = boosting ? 62 : 58;', 1)
t = t.replace('  camera.fov += (targetFov - camera.fov) * 0.08;',
              '  camera.fov += (targetFov - camera.fov) * 0.02;', 1)
t = t.replace('  camera.lookAt(carWorldX, 1.1, -16);',
              '  camera.lookAt(camera.position.x, 1.1, -16);', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(t)
print("game.js:", "DEFAULT_KEYMAP" in t, "capturingKey" in t, "camera.lookAt(camera.position.x" in t)

# ============ index.html ============
h = "D:/playcargame/index.html"
x = io.open(h, encoding="utf-8").read()

panel = '''      <div class="keymap-settings">
        <div class="keymap-title">快捷键（点按钮后按下你要用的键）</div>
        <div class="keymap-row">
          <button id="key-throttle" type="button">W</button><span>油门</span>
          <button id="key-brake" type="button">S</button><span>刹车</span>
          <button id="key-boost" type="button">Shift</button><span>加速</span>
          <button id="key-left" type="button">←</button><span>左转</span>
          <button id="key-right" type="button">→</button><span>右转</span>
          <button id="key-reset" type="button">恢复默认</button>
        </div>
      </div>
'''
if 'id="key-throttle"' not in x:
    anchor = '      <div class="room-controls"'
    assert anchor in x
    x = x.replace(anchor, panel + anchor, 1)

x = x.replace("game.js?v=43", "game.js?v=44")
io.open(h, "w", encoding="utf-8", newline="\n").write(x)
print("index.html:", 'id="key-throttle"' in x, "v=44" in x)
