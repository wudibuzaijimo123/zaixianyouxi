#!/usr/bin/env bash
echo "=== nginx access: race/rooms ==="
grep "race/rooms" /var/log/nginx/access.log | tail -12
echo "=== node journal ==="
journalctl -u playcargame -n 20 --no-pager | tail -10
echo "=== local create test ==="
curl -s -o /tmp/cr.json -w "code=%{http_code}\n" -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"create","name":"t"}' \
  -H "Host: api.game.yhj123.dpdns.org" \
  -k https://127.0.0.1/api/race/rooms
cat /tmp/cr.json; echo
echo "=== join unknown room ==="
curl -s -o /tmp/jr.json -w "code=%{http_code}\n" -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"join","roomCode":"1101","name":"t"}' \
  -H "Host: api.game.yhj123.dpdns.org" \
  -k https://127.0.0.1/api/race/rooms
cat /tmp/jr.json; echo
echo "=== deployed version markers ==="
grep -c "raceSync" /opt/playcargame/game.js
grep -c "makeNameTag" /opt/playcargame/game.js
grep -c "startAt" /opt/playcargame/server.js
