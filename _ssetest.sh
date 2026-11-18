#!/usr/bin/env bash
cd /opt/playcargame || exit 1
node --check game.js && node --check server.js && echo "syntax OK"
systemctl restart playcargame
sleep 2
systemctl is-active playcargame
echo "--- SSE 测试（2 秒）---"
CODE=SSETEST
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"action":"join","roomCode":"SSETEST","name":"A"}' -H 'Host: api.game.yhj123.dpdns.org' -k https://127.0.0.1/api/race/rooms
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"action":"join","roomCode":"SSETEST","name":"B"}' -H 'Host: api.game.yhj123.dpdns.org' -k https://127.0.0.1/api/race/rooms
timeout 2 curl -sN -H 'Host: api.game.yhj123.dpdns.org' -k 'https://127.0.0.1/api/race/stream?roomCode=SSETEST&playerId=x' | head -c 400
echo
echo "--- 推送条数（2 秒内）---"
timeout 2 curl -sN -H 'Host: api.game.yhj123.dpdns.org' -k 'https://127.0.0.1/api/race/stream?roomCode=SSETEST&playerId=x' | grep -c '^data:'
