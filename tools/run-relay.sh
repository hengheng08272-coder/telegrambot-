#!/usr/bin/env bash
# Linux / macOS launcher. Edit the four values below, then:
#   chmod +x run-relay.sh
#   ./run-relay.sh          # start the relay
#   ./run-relay.sh list     # just print chat ids
set -euo pipefail
cd "$(dirname "$0")"

export TG_API_ID=REPLACE_ME
export TG_API_HASH=REPLACE_ME
export ABA_INGEST_SECRET=REPLACE_ME
export ABA_SOURCE_CHATS=-5588646530

export ABA_INGEST_URL=https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/aba-notify-ingest
export ABA_TEXT_FILTER=S2_Nint.Ani

if [ "$TG_API_ID" = "REPLACE_ME" ]; then
  echo "Fill in TG_API_ID, TG_API_HASH and ABA_INGEST_SECRET in this file first."
  exit 1
fi

exec python3 aba-userbot-forwarder.py "${1:-run}"
