#!/bin/sh
# Sauvegarde à chaud cohérente de la base (SQLite WAL) — à lancer via cron.
set -e
DB="${PPL_DB:-data/ppl.sqlite}"; OUT="${1:-backups}"; mkdir -p "$OUT"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec(\"VACUUM INTO '\"+process.argv[2].replace(/'/g,'')+\"'\")" "$DB" "$OUT/ppl-$(date +%Y%m%d-%H%M%S).sqlite"
ls -1t "$OUT" | tail -n +15 | while read f; do rm -f "$OUT/$f"; done
