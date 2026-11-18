#!/usr/bin/env bash
echo "=== POST /api/race/rooms (last 20) ==="
grep "race/rooms" /var/log/nginx/access.log | tail -20
echo
echo "=== POST /api/race/state (last 8) ==="
grep "race/state" /var/log/nginx/access.log | tail -8
echo
echo "=== app log: room 1101 ==="
journalctl -u playcargame --since "-20min" --no-pager | grep -i "room 1101" | tail -25
echo
echo "=== app log tail ==="
journalctl -u playcargame --since "-20min" --no-pager | tail -20
