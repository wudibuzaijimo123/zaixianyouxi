#!/usr/bin/env bash
cd /opt/playcargame || exit 1
python3 - <<'PY'
import io
for f in ("index.html", "game.js", "server.js"):
    t = io.open(f, encoding="utf-8").read()
    cjk = sum(1 for c in t if "\u4e00" <= c <= "\u9fff")
    print(f, "bytes", len(t.encode("utf-8")), "CJK", cjk, "mojibake", t.count("\u9350"), t.count("\u93b4"))
PY
systemctl restart playcargame
sleep 2
systemctl is-active playcargame
curl -s -o /tmp/idx.html -w 'served_index=%{http_code} type=%{content_type}\n' -H 'Host: api.game.yhj123.dpdns.org' -k https://127.0.0.1/
echo -n "served has 默认静音: "; grep -c '默认静音' /tmp/idx.html || true
echo -n "served has 乱码标记: "; grep -c '鍐\|鎴' /tmp/idx.html || true
