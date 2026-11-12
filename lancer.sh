#!/usr/bin/env bash
# Lance le site de writeups et l'ouvre dans le navigateur
cd "$(dirname "$(readlink -f "$0")")"
PORT="${PORT:-8137}"
URL="http://127.0.0.1:$PORT"
if curl -s -o /dev/null "$URL/api/writeups"; then
  echo "Déjà lancé → $URL"
else
  nohup python3 server.py > data/server.log 2>&1 &
  echo $! > data/server.pid
  for _ in $(seq 25); do curl -s -o /dev/null "$URL/api/writeups" && break; sleep 0.2; done
  echo "✔ Serveur lancé → $URL  (logs : data/server.log, arrêt : ./arreter.sh)"
fi
[ "$1" = "--no-open" ] || xdg-open "$URL" >/dev/null 2>&1 &
