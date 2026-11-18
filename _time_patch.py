import io

p = "D:/playcargame/game.js"
t = io.open(p, encoding="utf-8").read()

# 1) 最佳用时变量 + 格式化函数
old = 'let best = Number(localStorage.getItem("neonRushBest") || 0);'
new = ('let best = Number(localStorage.getItem("neonRushBest") || 0);\n'
       'let bestTime = Number(localStorage.getItem("racerBestTime") || 0);   // 秒，0 表示还没跑过\n'
       '\n'
       'function formatRaceTime(sec) {\n'
       '  if (!sec || !isFinite(sec)) return "--";\n'
       '  const m = Math.floor(sec / 60);\n'
       '  const s = sec - m * 60;\n'
       '  return `${m}:${s.toFixed(1).padStart(4, "0")}`;\n'
       '}')
assert old in t
t = t.replace(old, new, 1)

# 2) 初始显示最佳用时
t = t.replace('bestEl.textContent = best;', 'bestEl.textContent = formatRaceTime(bestTime);')

# 3) 重置计时
old = 'scoreEl.textContent = "0";'
assert old in t
t = t.replace(old, 'raceTime = 0;\n  scoreEl.textContent = formatRaceTime(0);', 1)

# 4) 每帧累计用时并刷新 HUD
old = 'score += currentSpeed * 0.45;'
assert old in t
t = t.replace(old, 'score += currentSpeed * 0.45;\n  raceTime += 1 / 60;', 1)

old = 'scoreEl.textContent = Math.floor(score);'
assert old in t
t = t.replace(old, 'scoreEl.textContent = formatRaceTime(raceTime);', 1)

# 5) 冲线：显示用时并更新最佳用时
old = 'message.innerHTML = `完成 ${Math.floor(finishDistance / 100) / 10} km 卡丁车赛道！<br>最终成绩：<b style="color:#61efff;font-size:24px">${Math.floor(score)}</b>`;'
assert old in t
new = ('if (!bestTime || raceTime < bestTime) {\n'
       '    bestTime = raceTime;\n'
       '    localStorage.setItem("racerBestTime", String(bestTime));\n'
       '  }\n'
       '  bestEl.textContent = formatRaceTime(bestTime);\n'
       '  message.innerHTML = `完成 ${Math.floor(finishDistance / 100) / 10} km 赛道！<br>'
       '用时：<b style="color:#61efff;font-size:24px">${formatRaceTime(raceTime)}</b><br>'
       '最佳：${formatRaceTime(bestTime)}`;')
t = t.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(t)
print("raceTime", t.count("raceTime"), "formatRaceTime", t.count("formatRaceTime"), "bestTime", t.count("bestTime"))
