#!/usr/bin/env bash
# Backup lógico do banco apontado por DATABASE_URL.
#
# O plano gratuito do Neon retém 6 horas de histórico. Seis horas cobrem um
# "apaguei sem querer" percebido na hora; não cobrem uma corrupção notada na
# segunda-feira. Este dump é a cópia que sobrevive a isso — e que fica fora
# da infraestrutura que ele deveria proteger.
#
#   $env:DATABASE_URL="..."   # PowerShell
#   pnpm db:backup
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL não definido." >&2
  exit 1
fi

DESTINO="${BACKUP_DIR:-./backups}"
mkdir -p "$DESTINO"
ARQUIVO="$DESTINO/mastershopee-$(date +%Y%m%d-%H%M%S).dump"

# Formato custom (-Fc): comprimido e restaurável seletivamente com pg_restore,
# ao contrário do SQL puro, que é tudo ou nada.
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$ARQUIVO"

echo "Backup gravado em $ARQUIVO"
echo "Restaurar com: pg_restore --clean --no-owner --dbname=\"\$DATABASE_URL\" $ARQUIVO"
