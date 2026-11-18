#!/usr/bin/env bash
cd /opt/playcargame || exit 1
node --check game.js && node --check server.js && echo "syntax OK"
# 旧数据是分数制，清空改成用时制（备份保留）
STAMP=$(date +%Y%m%d-%H%M%S)
cp -f data/scores.json "data/scores.backup-$STAMP.json" 2>/dev/null || true
echo "[]" > data/scores.json
systemctl restart playcargame
sleep 2
systemctl is-active playcargame
echo "--- 提交一条用时成绩测试 ---"
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"测试","time":83.4}' -H 'Host: api.game.yhj123.dpdns.org' -k https://127.0.0.1/api/scores | head -c 200
echo
curl -s -H 'Host: api.game.yhj123.dpdns.org' -k https://127.0.0.1/api/scores | head -c 200
echo
