#!/usr/bin/env python3
"""
ABA userbot relay — reads the ABA payment alert out of Telegram and POSTs
it to the `aba-notify-ingest` Supabase function.

WHY THIS EXISTS
    Telegram bots can never see messages written by another bot. A real
    user ACCOUNT can. So this logs in as your own Telegram account
    (MTProto, via Telethon), watches whichever chat the ABA alerts land
    in, and relays the text over HTTPS. It never posts, replies, joins,
    or reads anything it is not told to watch.

TWO MODES
    list   - print every chat your account can see, with its id, so you
             can find where the ABA alerts actually arrive:
                 python3 aba-userbot-forwarder.py list
    run    - watch and relay (the default):
                 python3 aba-userbot-forwarder.py

REQUIREMENTS
    pip install telethon requests
    A machine that stays awake. A laptop that sleeps silently stops
    confirming payments — that is the main failure mode of this route.

SECURITY
    The .session file this creates is a full login to that Telegram
    account — anyone who copies it is logged in as you. Keep it off
    shared drives and out of git. A second, dedicated Telegram account is
    safer than your personal one.
"""

import os
import sys
import time
from datetime import datetime

import requests
from telethon import TelegramClient, events

# ----------------------------------------------------------------------
# CONFIG — environment variables win over the literals here.
# ----------------------------------------------------------------------
API_ID = int(os.environ.get("TG_API_ID", "0"))
API_HASH = os.environ.get("TG_API_HASH", "")

# Where the ABA alerts arrive. A numeric chat id (-100... for a group or
# channel, a positive id for a DM), a @username, or "me" for Saved
# Messages. Comma-separate for several. Empty = watch EVERY chat, which
# is noisy but useful on a first run.
# Their live setup: the "PayWay by ABA" bot posts every merchant alert
# into a Telegram group named ABA_NOTIFIER. PayWay itself printed that
# group's id in the chat ("Your Telegram Group ID: -5588646530"), so it
# is prefilled here. Run `list` mode to confirm the exact id Telethon
# uses for it before trusting this default.
SOURCE_CHATS = os.environ.get("ABA_SOURCE_CHATS", "-5588646530")

INGEST_URL = os.environ.get(
    "ABA_INGEST_URL",
    "https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/aba-notify-ingest",
)
INGEST_SECRET = os.environ.get("ABA_INGEST_SECRET", "")

# Only relay messages containing this (case-insensitive) — normally the
# ABA account name, the same value as `aba_merchant_name` in the Admin
# Panel. Keeps unrelated chatter out of the relay entirely. Empty =
# relay everything from the source chats.
TEXT_MUST_CONTAIN = os.environ.get("ABA_TEXT_FILTER", "S2_Nint.Ani")

SESSION_NAME = os.environ.get("ABA_SESSION_NAME", "aba_relay_session")

# The server already refuses a repeated Trx ID, so this is only a second
# layer — it stops pointless POSTs when Telethon replays a message after
# a reconnect.
_seen = set()
# ----------------------------------------------------------------------


def log(msg):
    print("{:%Y-%m-%d %H:%M:%S} {}".format(datetime.now(), msg), flush=True)


def parse_sources(raw):
    out = []
    for part in [p.strip() for p in raw.split(",") if p.strip()]:
        try:
            out.append(int(part))
        except ValueError:
            out.append(part)
    return out


def relay(text):
    """POST to the ingest function, retrying a few times.

    A payment has already left the customer's account by this point, so a
    transient network blip must not be the reason they never get VIP.
    Three attempts with a growing pause covers a wifi hiccup; anything
    longer is a real outage, and the receipt-upload fallback in the app
    takes over.
    """
    for attempt in range(1, 4):
        try:
            resp = requests.post(
                INGEST_URL,
                json={"text": text},
                headers={"x-aba-ingest-secret": INGEST_SECRET},
                timeout=15,
            )
            log("[RELAY] {} {}".format(resp.status_code, resp.text[:200]))
            if resp.status_code < 500:
                return  # 2xx/4xx are final answers, not worth retrying
        except Exception as exc:  # noqa: BLE001 — one failure must not kill the relay
            log("[ERROR] attempt {}/3 failed: {}".format(attempt, exc))
        time.sleep(attempt * 3)
    log("[ERROR] gave up after 3 attempts — the app's receipt-upload fallback covers this")


async def list_chats(client):
    log("Chats your account can see (copy the id of the one with ABA alerts):")
    print("{:>16}  {:<9}  NAME".format("ID", "TYPE"))
    async for dialog in client.iter_dialogs():
        kind = "channel" if dialog.is_channel else "group" if dialog.is_group else "user"
        print("{:>16}  {:<9}  {}".format(dialog.id, kind, dialog.name))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "run"

    if not API_ID or not API_HASH:
        log("ERROR: set TG_API_ID and TG_API_HASH (from my.telegram.org).")
        return 1

    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)

    if mode == "list":
        with client:
            client.loop.run_until_complete(list_chats(client))
        return 0

    if not INGEST_SECRET:
        log("ERROR: set ABA_INGEST_SECRET (same value as the Supabase secret).")
        return 1

    sources = parse_sources(SOURCE_CHATS)

    # chats=None means every chat — intentional, so a first run can be
    # used to discover where the alerts land from the [SEEN] lines.
    @client.on(events.NewMessage(chats=sources or None))
    async def handler(event):
        text = (event.message.message or "").strip()
        if not text:
            return

        key = (event.chat_id, event.message.id)
        if key in _seen:
            return
        _seen.add(key)
        if len(_seen) > 5000:
            _seen.clear()

        log("[SEEN] chat={} text={!r}".format(event.chat_id, text[:120]))

        if TEXT_MUST_CONTAIN and TEXT_MUST_CONTAIN.upper() not in text.upper():
            return

        relay(text)

    log("Starting relay. The first run asks for your phone number + login code.")
    log("Watching: {}".format(sources or "ALL CHATS (set ABA_SOURCE_CHATS to narrow)"))
    log("Filter:   {}".format(TEXT_MUST_CONTAIN or "(none)"))
    log("Target:   {}".format(INGEST_URL))
    client.start()
    client.run_until_disconnected()
    return 0


if __name__ == "__main__":
    sys.exit(main())
