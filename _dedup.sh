#!/usr/bin/env bash
cd /opt/playcargame || exit 1
node --check game.js && node --check server.js && echo "syntax OK"
# 排行榜：只保留最高分一份，清掉历史里的重复名字
STAMP=$(date +%Y%m%d-%H%M%S)
cp -f data/scores.json "data/scores.backup-$STAMP.json" 2>/dev/null || true
python3 - <<'PY'
import json, io
path = "data/scores.json"
try:
    data = json.load(io.open(path, encoding="utf-8"))
except Exception:
    data = []
if not isinstance(data, list):
    data = []
best = {}
for item in data:
    name = str(item.get("name", "")).strip()
    if not name:
        continue
    key = name.lower()
    score = float(item.get("score", 0) or 0)
    if key not in best or score > float(best[key].get("score", 0) or 0):
        best[key] = item
out = sorted(best.values(), key=lambda x: float(x.get("score", 0) or 0), reverse=True)[:20]
io.open(path, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
print("kept", len(out), "unique names")
PY
systemctl restart playcargame
sleep 2
systemctl is-active playcargame
curl -s -H 'Host: api.game.yhj123.dpdns.org' -k https://127.0.0.1/api/scores | head -c 300
echo
