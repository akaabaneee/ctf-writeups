#!/usr/bin/env bash
cd "$(dirname "$(readlink -f "$0")")"
if [ -f data/server.pid ] && kill "$(cat data/server.pid)" 2>/dev/null; then
  rm -f data/server.pid; echo "Serveur arrêté."
else
  rm -f data/server.pid; echo "Le serveur ne tournait pas."
fi
