#!/usr/bin/env python3
"""
tg_video_to_s3.py

Download every video from a Telegram channel/group with YOUR OWN account
(userbot, not a bot), store it (S3-compatible bucket or a local folder),
then delete the local temp file.

MODES
    python tg_video_to_s3.py list      -> print every chat you are in + its id
    python tg_video_to_s3.py           -> backfill: scan the chat, grab everything
    python tg_video_to_s3.py watch     -> stay open, grab new videos as they arrive
    python tg_video_to_s3.py auto      -> backfill first, then keep watching
    python tg_video_to_s3.py topics    -> list the group's topics (one show each)
    python tg_video_to_s3.py shows     -> group the videos by show name
    python tg_video_to_s3.py pick      -> list what is missing, choose 1-5,8,12
    python tg_video_to_s3.py links     -> reprint the link list for the Admin panel
    python tg_video_to_s3.py bench     -> measure 1-connection vs N-connection speed
    python tg_video_to_s3.py selftest  -> offline sanity check (no Telegram login)

WHY IT IS FAST
    One Telegram connection is speed-limited by the server, not by your line.
    So this opens several connections that share the same login and each one
    pulls a different byte range of the same video at the same time
    (TG_CONNECTIONS). On top of that, uploads happen on their own workers, so
    the next video is already downloading while the previous one uploads.
    Install `cryptg` too - without it Python does the MTProto AES decryption
    itself and that alone can halve your speed.

Everything is configured with environment variables (see run-download.bat).
Logs are ASCII-only on purpose so the Windows console never crashes on them.
"""

import asyncio
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from telethon import TelegramClient, events
    from telethon.errors import FloodWaitError
    from telethon.sessions import StringSession
    from telethon.tl.types import DocumentAttributeFilename, DocumentAttributeVideo
except ImportError:
    print("[FATAL] telethon is not installed. Run install-windows.bat first.")
    sys.exit(1)


# ---------------------------------------------------------------- config ----

def env(name, default=None, required=False):
    value = os.environ.get(name, default)
    if isinstance(value, str):
        value = value.strip().strip('"')
    if required and not value:
        print(f"[FATAL] missing setting: {name} (edit run-download.bat)")
        sys.exit(1)
    return value


def env_int(name, default):
    raw = env(name, str(default))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def env_float(name, default):
    raw = env(name, str(default))
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def env_bool(name, default=False):
    raw = (env(name, "1" if default else "0") or "").lower()
    return raw in ("1", "true", "yes", "y", "on")


CONFIG_FILE = Path(__file__).resolve().parent / "config.json"
MODE = (sys.argv[1].lower() if len(sys.argv) > 1 else "run")


def load_config():
    """api_id / api_hash come from config.json next to this script.

    Environment variables still win, so an already-filled .bat keeps working.
    If neither is set, ask once and remember the answer.
    """
    saved = {}
    if CONFIG_FILE.exists():
        try:
            saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            saved = {}

    api_id = env("TG_API_ID", "") or str(saved.get("api_id", "") or "")
    api_hash = env("TG_API_HASH", "") or str(saved.get("api_hash", "") or "")

    if not api_id or not api_hash:
        print()
        print("=" * 62)
        print(" First-time setup - get these at https://my.telegram.org")
        print(" (log in -> API development tools -> your app)")
        print("=" * 62)
        while not api_id.isdigit():
            api_id = input(" api_id   (numbers only) : ").strip()
        while len(api_hash) < 20:
            api_hash = input(" api_hash (32 characters): ").strip()
        try:
            CONFIG_FILE.write_text(
                json.dumps({"api_id": int(api_id), "api_hash": api_hash}, indent=1),
                encoding="utf-8",
            )
            print(f"\n saved to {CONFIG_FILE.name} - you will not be asked again\n")
        except Exception as exc:
            print(f"\n [WARN] could not save config.json: {exc}\n")

    return int(api_id), api_hash


# selftest never talks to Telegram, so it must never ask for credentials
if MODE in ("selftest", "links"):
    API_ID, API_HASH = 0, ""
else:
    API_ID, API_HASH = load_config()

SESSION       = env("TG_SESSION", "tg_downloader")
SOURCE_CHAT   = env("TG_SOURCE_CHAT", "")

S3_BUCKET     = env("S3_BUCKET", "")
S3_PREFIX     = env("S3_PREFIX", "telegram/")
S3_REGION     = env("AWS_REGION", "ap-southeast-1")
S3_STORAGE    = env("S3_STORAGE_CLASS", "")          # e.g. STANDARD_IA, AWS only
S3_ENDPOINT   = env("S3_ENDPOINT", "")               # R2 / Wasabi / Spaces / MinIO
S3_ADDRESSING = env("S3_ADDRESSING", "")             # "path" if the provider needs it
PUBLIC_BASE   = env("PUBLIC_BASE_URL", "")           # e.g. https://cdn.example.com/
URL_LIST      = env("URL_LIST_FILE", "uploaded_urls.csv")

TEMP_DIR      = Path(env("TEMP_DIR", "./_tmp"))
STATE_DIR     = Path(env("STATE_DIR", "./_state"))
SAVE_DIR      = Path(env("SAVE_DIR", "./downloads"))  # used when S3_BUCKET is empty
KEEP_LOCAL    = env_bool("KEEP_LOCAL", False)
MIN_MB        = env_float("MIN_MB", 0)
MAX_ITEMS     = env_int("MAX_ITEMS", 0)              # 0 = no limit
NEWEST_FIRST  = env_bool("NEWEST_FIRST", False)
DRY_RUN       = env_bool("DRY_RUN", False)

# --- choosing WHICH videos ---------------------------------------------------
# A group that carries many different shows is worked one show at a time:
# FILTER picks the show, S3_PREFIX gives it its own folder and its own link
# list, so the links can be pasted into that show's Bulk import.
TG_TOPIC      = env_int("TG_TOPIC", 0)   # one forum topic only (see `topics` mode)
FILTER        = env("FILTER", "")        # keyword or regex, matched on filename+caption
ONLY_IDS      = env("ONLY_IDS", "")      # exact message ids, comma separated
SINCE         = env("SINCE", "")         # YYYY-MM-DD, skip anything older
UNTIL         = env("UNTIL", "")         # YYYY-MM-DD, skip anything newer
MAX_MB        = env_float("MAX_MB", 0)   # skip files bigger than this
PICK_LIMIT    = env_int("PICK_LIMIT", 300)   # how many rows `pick` lists at once
EP_KEYS       = env_bool("EP_KEYS", True)    # name keys <prefix>ep-<n>/<file>
LINKS_FILE    = env("LINKS_FILE", "")        # default: links_<prefix>.txt
RESCAN_ALL    = env_bool("RESCAN_ALL", False)  # ignore the saved scan position


def _compile_filter(raw):
    """FILTER is a regex, but a plain keyword must keep working even when it
    contains characters a regex would choke on."""
    if not raw:
        return None
    try:
        return re.compile(raw, re.IGNORECASE)
    except re.error:
        return re.compile(re.escape(raw), re.IGNORECASE)


def _parse_date(raw, name):
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        print(f"[FATAL] {name} must look like 2026-01-31, got {raw!r}")
        sys.exit(1)


FILTER_RE  = _compile_filter(FILTER)
ONLY_ID_SET = {int(x) for x in re.findall(r"-?\d+", ONLY_IDS)}
SINCE_DATE = _parse_date(SINCE, "SINCE")
UNTIL_DATE = _parse_date(UNTIL, "UNTIL")

# --- speed knobs -------------------------------------------------------------
# connections that split ONE video between them (the big win; 4-8 is the sweet
# spot, more than 8 usually just earns you a FloodWait)
TG_CONNECTIONS  = max(1, min(env_int("TG_CONNECTIONS", 4), 16))
# how many videos are downloaded at the same time
TG_WORKERS      = max(1, min(env_int("TG_WORKERS", 2), 8))
# how many finished videos are uploaded at the same time
TG_UPLOADERS    = max(1, min(env_int("TG_UPLOADERS", 2), 8))
# files smaller than this are not worth splitting (connection setup costs more)
PARALLEL_MIN_MB = env_float("PARALLEL_MIN_MB", 8)
# S3 multipart tuning
UP_CHUNK_MB     = max(5, env_int("UPLOAD_CHUNK_MB", 16))
UP_CONCURRENCY  = max(1, min(env_int("UPLOAD_CONCURRENCY", 8), 32))

CHUNK       = 512 * 1024        # Telegram's largest allowed request size
LOG_EVERY   = 5.0               # seconds between % lines

LOCAL_ONLY  = not S3_BUCKET     # no bucket configured -> keep files on disk


def log(msg):
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {msg}", flush=True)


def human(n):
    if n is None:
        return "?"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{int(n)}B" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}GB"


def rate(nbytes, seconds):
    if seconds <= 0:
        return "?"
    return f"{human(nbytes / seconds)}/s"


# ----------------------------------------------------------------- state ----

_state_lock = None      # created inside the loop; selftest runs without one


def state_path(chat_id):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^0-9a-zA-Z_-]", "_", str(chat_id))
    return STATE_DIR / f"done_{safe}.json"


def load_state(chat_id):
    p = state_path(chat_id)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        log("[WARN] state file unreadable, starting a fresh one")
        return {}


def save_state(chat_id, state):
    p = state_path(chat_id)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


# ------------------------------------------------------------- telegram -----

def video_info(msg):
    """Return (size, filename, mime) when the message holds a video, else None."""
    doc = getattr(msg, "document", None)
    if doc is None:
        return None

    mime = (getattr(doc, "mime_type", "") or "").lower()
    attrs = getattr(doc, "attributes", []) or []
    is_video = mime.startswith("video/") or any(
        isinstance(a, DocumentAttributeVideo) for a in attrs
    )
    if not is_video:
        return None

    name = None
    for a in attrs:
        if isinstance(a, DocumentAttributeFilename):
            name = a.file_name
            break
    if not name:
        ext = ".mp4"
        if "matroska" in mime:
            ext = ".mkv"
        elif "quicktime" in mime:
            ext = ".mov"
        elif "webm" in mime:
            ext = ".webm"
        name = f"video_{msg.id}{ext}"

    # some videos arrive as generic documents; S3 must still get a video type
    content_type = mime if mime.startswith("video/") else "video/mp4"
    return getattr(doc, "size", 0) or 0, name, content_type


def safe_name(name):
    name = re.sub(r"[\\/:*?\"<>|\r\n\t]", "_", name).strip(" ._")
    return name[:120] or "video.mp4"


def printable(text):
    """Windows consoles still die on some characters; never let a filename
    stop a download."""
    try:
        (text or "").encode(sys.stdout.encoding or "utf-8")
        return text
    except (UnicodeEncodeError, LookupError):
        return (text or "").encode("ascii", "replace").decode("ascii")


# Khmer digits, so "ភាគ ១២" is read as episode 12 just like "EP12"
KHMER_DIGITS = str.maketrans("០១២៣៤៥៦៧៨៩", "0123456789")

EP_PATTERNS = [
    # S02E05 -> 5. Checked first, or the season number would win.
    re.compile(r"s\d{1,2}[ ._\-]*e(\d{1,4})(?![0-9])", re.IGNORECASE),
    # EP12 / ep-12 / Episode 12 / part 12 / E12
    re.compile(r"(?:^|[^0-9a-z])(?:ep|epi|episode|part|e)[ ._\-]*(\d{1,4})(?![0-9])",
               re.IGNORECASE),
    # ភាគ ១២ / ភាគទី 12
    re.compile(r"ភាគ(?:ទី)?[ ._\-]*(\d{1,4})"),
    # "One Piece - 1088.mp4", "Naruto_220.mkv"
    re.compile(r"[ ._\-\[(](\d{1,4})[ ._\-\])]*\.(?:mp4|mkv|mov|webm|avi)$",
               re.IGNORECASE),
]


def episode_number(name, caption=""):
    """Read the episode number out of the filename, else out of the caption.

    This is what lets the Admin panel's Bulk import number the episodes for
    you: the number ends up in the object key as `/ep-<n>/`, which is exactly
    what that box reads.
    """
    for text in (name or "", caption or ""):
        text = text.translate(KHMER_DIGITS)
        for pattern in EP_PATTERNS:
            hit = pattern.search(text)
            if hit:
                n = int(hit.group(1))
                if 0 < n < 10000:
                    return n
    return None


def topic_id(msg):
    """Which forum topic a message sits in, or None outside a forum.

    A topic is really a thread hanging off its own root message, so the id we
    want is the top of that thread - or the root message itself for a message
    posted straight into the topic.
    """
    head = getattr(msg, "reply_to", None)
    if head is None or not getattr(head, "forum_topic", False):
        return None
    return getattr(head, "reply_to_top_id", None) or getattr(head, "reply_to_msg_id", None)


# quality/release tags that are part of the file name but not of the show name
NOISE = re.compile(
    r"\b(1080p|720p|480p|360p|2160p|4k|x264|x265|h\.?264|h\.?265|hevc|avc|aac|"
    r"web-?dl|web-?rip|blu-?ray|hd-?rip|dvd-?rip|hdtv|10bit|dual|multi|"
    r"sub|subbed|dub|dubbed|raw|eng|jpn|kh|khmer|speak|full)\b",
    re.IGNORECASE)


def show_title(name, caption=""):
    """The show name a file belongs to: everything before the episode marker,
    with the release tags stripped. `NARUTO.SHIPPUDEN.EP01.1080p.mp4` and
    `Naruto Shippuden - 02 [720p].mkv` both come back as `Naruto Shippuden`."""
    text = (name or "").strip()
    if not text:
        text = ((caption or "").strip().splitlines() or [""])[0]
    text = text.translate(KHMER_DIGITS)

    # Cut at the first episode marker - what follows is numbering, not a name.
    # The extension is still attached here on purpose: a bare trailing number
    # ("One Piece - 1088.mp4") is only recognisable as an episode next to it.
    cut = len(text)
    for pattern in EP_PATTERNS:
        hit = pattern.search(text)
        if hit:
            cut = min(cut, hit.start())
    text = text[:cut]
    text = re.sub(r"\.[a-z0-9]{2,4}$", "", text, flags=re.IGNORECASE)

    text = NOISE.sub(" ", text)
    text = re.sub(r"[\[\]\(\)_.\-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -_.")

    # A number still hanging off the end is the episode: "Naruto Shippuden 02"
    # once "[720p]" has gone. This does cost a show whose real name ends in a
    # number, which is why the suggested FILTER is printed for you to edit.
    text = re.sub(r"\s+\d{1,4}$", "", text).strip()
    return text


def slug(text):
    out = re.sub(r"[^0-9a-zA-Z]+", "-", (text or "").lower()).strip("-")
    return out or "show"


def build_key(msg, name, ep):
    """Where the file lands in the bucket.

    With an episode number: `<prefix>ep-12/<name>` - the Admin panel reads the
    12 straight out of that path. Without one: the old `<prefix><id>_<name>`,
    which at least keeps the order.
    """
    if EP_KEYS and ep is not None:
        return f"{S3_PREFIX}ep-{ep}/{name}"
    return f"{S3_PREFIX}{msg.id:06d}_{name}"


def unwanted(msg, size, name):
    """Why this video should be skipped, or None when it should be downloaded."""
    if TG_TOPIC and topic_id(msg) != TG_TOPIC:
        return "in another topic"
    if ONLY_ID_SET and msg.id not in ONLY_ID_SET:
        return "not in ONLY_IDS"
    if MIN_MB and size < MIN_MB * 1024 * 1024:
        return f"smaller than MIN_MB ({human(size)})"
    if MAX_MB and size > MAX_MB * 1024 * 1024:
        return f"bigger than MAX_MB ({human(size)})"
    when = getattr(msg, "date", None)
    if when:
        if SINCE_DATE and when.date() < SINCE_DATE:
            return "older than SINCE"
        if UNTIL_DATE and when.date() > UNTIL_DATE:
            return "newer than UNTIL"
    if FILTER_RE:
        caption = getattr(msg, "message", "") or ""
        if not FILTER_RE.search(f"{name}\n{caption}"):
            return "does not match FILTER"
    return None


def parse_selection(text, count):
    """'1-5, 8, 12' or 'all' -> [1, 2, 3, 4, 5, 8, 12] (1-based, deduped)."""
    text = (text or "").strip().lower()
    if not text:
        return []
    if text in ("all", "a", "*"):
        return list(range(1, count + 1))

    picked = set()
    for part in re.split(r"[,\s]+", text):
        if not part:
            continue
        span = re.fullmatch(r"(\d+)\s*-\s*(\d+)", part)
        if span:
            lo, hi = int(span.group(1)), int(span.group(2))
            if lo > hi:
                lo, hi = hi, lo
            picked.update(range(lo, hi + 1))
        elif part.isdigit():
            picked.add(int(part))
    return sorted(n for n in picked if 1 <= n <= count)


async def cmd_list(client):
    log("your chats (copy the id you want into TG_SOURCE_CHAT):")
    print("-" * 78)
    async for dialog in client.iter_dialogs():
        kind = "channel" if dialog.is_channel else ("group" if dialog.is_group else "user")
        print(f"{str(dialog.id):>16}  {kind:<8}  {dialog.name}")
    print("-" * 78)


# ------------------------------------------------- parallel download core ---

class ConnectionPool:
    """Extra Telegram connections that share the SAME login as the main client.

    Telegram throttles per connection, not per account, so N connections each
    pulling a different slice of the file is close to N times faster until the
    line itself is the limit. The clones are built from the main session's auth
    key (StringSession keeps everything in memory), so they never touch the
    .session file and never ask for a login code.
    """

    def __init__(self, client, size):
        self.main = client
        self.size = max(0, size - 1)     # the main client is slice #1
        self.clients = []
        self.free = None

    async def start(self):
        self.free = asyncio.Queue()
        self.free.put_nowait(self.main)
        if not self.size:
            log("connections: 1 (set TG_CONNECTIONS higher to go faster)")
            return

        try:
            seed = StringSession.save(self.main.session)
        except Exception as exc:
            log(f"[WARN] cannot clone the session ({exc}) - using 1 connection")
            return
        if not seed:
            return

        for i in range(self.size):
            clone = TelegramClient(StringSession(seed), API_ID, API_HASH)
            try:
                await clone.connect()
                if not await clone.is_user_authorized():
                    raise RuntimeError("clone is not authorized")
            except Exception as exc:
                log(f"[WARN] extra connection {i + 2} failed ({exc}) - continuing")
                try:
                    await clone.disconnect()
                except Exception:
                    pass
                break
            self.clients.append(clone)
            self.free.put_nowait(clone)

        log(f"connections ready: {len(self.clients) + 1}")

    async def acquire(self, want):
        """Take up to `want` connections, blocking only for the first one."""
        got = [await self.free.get()]
        while len(got) < want:
            try:
                got.append(self.free.get_nowait())
            except asyncio.QueueEmpty:
                break
        return got

    def release(self, clients):
        for c in clients:
            self.free.put_nowait(c)

    async def stop(self):
        for c in self.clients:
            try:
                await c.disconnect()
            except Exception:
                pass
        self.clients = []


def plan_ranges(size, parts, align=CHUNK):
    """Split [0, size) into `parts` byte ranges that all start on a 512KB
    boundary - Telegram only accepts aligned offsets on its fast path."""
    if size <= 0:
        return [(0, 0)]
    parts = max(1, parts)

    bounds = [0]
    for i in range(1, parts):
        b = (size * i) // parts
        b -= b % align
        if b > bounds[-1]:
            bounds.append(b)
    bounds.append(size)
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]


async def _fetch_range(client, location, dest, start, end, on_bytes):
    """Pull [start, end) into `dest` at the right offset, one connection."""
    pos = start
    attempt = 0
    with open(dest, "r+b") as fh:
        while pos < end:
            need = end - pos
            limit = math.ceil(need / CHUNK)
            try:
                async for chunk in client.iter_download(
                    location, offset=pos, request_size=CHUNK, limit=limit
                ):
                    if not chunk:
                        break
                    room = end - pos
                    if len(chunk) > room:              # last chunk overshoots
                        chunk = chunk[:room]
                    fh.seek(pos)
                    fh.write(chunk)
                    pos += len(chunk)
                    on_bytes(len(chunk))
                    if pos >= end:
                        break
                if pos < end:
                    raise IOError(f"stream ended early at {pos}/{end}")
            except FloodWaitError as exc:
                log(f"    [WAIT] Telegram asked for {exc.seconds}s on one connection")
                await asyncio.sleep(exc.seconds + 2)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                attempt += 1
                if attempt > 4:
                    raise
                log(f"    [RETRY {attempt}/4] range {start}-{end}: {exc}")
                await asyncio.sleep(2 * attempt)
    return pos - start


async def download_fast(pool, msg, size, dest, label=""):
    """Download one video, splitting it across every free connection.

    Falls back to Telethon's ordinary single-connection download when the file
    is small, when only one connection is available, or when anything at all
    goes wrong on the fast path.
    """
    started = time.time()
    done = [0]
    last = [started]

    def on_bytes(n):
        done[0] += n
        now = time.time()
        if now - last[0] >= LOG_EVERY:
            last[0] = now
            pct = (done[0] / size * 100) if size else 0
            log(f"    {label}download {pct:5.1f}%  {human(done[0])}  "
                f"{rate(done[0], now - started)}")

    want = 1
    if size >= PARALLEL_MIN_MB * 1024 * 1024:
        want = min(TG_CONNECTIONS, max(1, int(size // (2 * 1024 * 1024))))

    clients = await pool.acquire(want)
    try:
        if len(clients) > 1 and size > 0:
            ranges = plan_ranges(size, len(clients))
            with open(dest, "wb") as fh:                 # preallocate
                fh.truncate(size)
            log(f"    {label}{len(ranges)} connections x ~{human(size / len(ranges))}")
            try:
                await asyncio.gather(*[
                    _fetch_range(c, msg.document, dest, a, b, on_bytes)
                    for c, (a, b) in zip(clients, ranges)
                ])
                took = time.time() - started
                log(f"    {label}downloaded {human(size)} in {took:.1f}s "
                    f"({rate(size, took)})")
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log(f"    [WARN] parallel download failed ({exc}) - retrying the slow way")

        # single connection (small file, or fast path unavailable)
        done[0] = 0
        started = time.time()

        def cb(recv, total):
            on_bytes(recv - done[0])

        await pool.main.download_media(msg, file=str(dest), progress_callback=cb)
        took = time.time() - started
        log(f"    {label}downloaded {human(size)} in {took:.1f}s ({rate(size, took)})")
    finally:
        pool.release(clients)


# --------------------------------------------------------------- storage ----

class Storage:
    """Where finished videos go: an S3-compatible bucket, or a local folder
    when S3_BUCKET is left empty."""

    def __init__(self):
        self.local = LOCAL_ONLY
        self.s3 = None
        if self.local:
            SAVE_DIR.mkdir(parents=True, exist_ok=True)
            log(f"storage: local folder {SAVE_DIR.resolve()}")
            return

        try:
            import boto3
            from boto3.s3.transfer import TransferConfig
            from botocore.config import Config as BotoConfig
            from botocore.exceptions import ClientError
        except ImportError:
            print("[FATAL] boto3 is not installed. Run install-windows.bat first,")
            print("        or leave S3_BUCKET empty to just save the files locally.")
            sys.exit(1)

        self._ClientError = ClientError
        self._cfg = TransferConfig(
            multipart_threshold=UP_CHUNK_MB * 1024 * 1024,
            multipart_chunksize=UP_CHUNK_MB * 1024 * 1024,
            max_concurrency=UP_CONCURRENCY,
            use_threads=True,
        )

        opts = {"signature_version": "s3v4",
                "max_pool_connections": UP_CONCURRENCY * TG_UPLOADERS + 4}
        if S3_ADDRESSING:
            opts["s3"] = {"addressing_style": S3_ADDRESSING}
        kwargs = {"region_name": S3_REGION, "config": BotoConfig(**opts)}
        if S3_ENDPOINT:
            kwargs["endpoint_url"] = S3_ENDPOINT
            log(f"storage endpoint: {S3_ENDPOINT}")
        else:
            log("storage endpoint: AWS S3 (default)")
        self.s3 = boto3.client("s3", **kwargs)

    # -- lookups ------------------------------------------------------------
    def url(self, key):
        if PUBLIC_BASE:
            return PUBLIC_BASE.rstrip("/") + "/" + key.lstrip("/")
        if self.local:
            return str((SAVE_DIR / key).resolve())
        if S3_ENDPOINT:
            return f"{S3_ENDPOINT.rstrip('/')}/{S3_BUCKET}/{key}"
        return f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"

    def exists(self, key, size):
        """True when the object is already stored with the same size."""
        if self.local:
            p = SAVE_DIR / key
            return p.exists() and (not size or p.stat().st_size == size)
        try:
            head = self.s3.head_object(Bucket=S3_BUCKET, Key=key)
        except self._ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "403"):
                return False
            raise
        return not size or head.get("ContentLength") == size

    # -- writes (blocking; always called through asyncio.to_thread) ----------
    def put(self, path, key, mime, size, label=""):
        started = time.time()
        if self.local:
            dest = SAVE_DIR / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(str(path), str(dest))
            log(f"    {label}saved -> {dest}")
            return

        extra = {"ContentType": mime}
        if S3_STORAGE and not S3_ENDPOINT:
            # R2/Wasabi/Spaces reject AWS storage classes
            extra["StorageClass"] = S3_STORAGE

        last = [0.0]
        done = [0]

        def cb(chunk):
            done[0] += chunk
            now = time.time()
            if now - last[0] >= LOG_EVERY:
                last[0] = now
                pct = (done[0] / size * 100) if size else 0
                log(f"    {label}upload {pct:5.1f}%  {human(done[0])}  "
                    f"{rate(done[0], now - started)}")

        self.s3.upload_file(str(path), S3_BUCKET, key,
                            ExtraArgs=extra, Config=self._cfg, Callback=cb)
        took = time.time() - started
        log(f"    {label}uploaded {human(size)} in {took:.1f}s ({rate(size, took)})")


def remember_url(storage, key):
    """Append the finished object to a CSV so the URLs can be bulk-copied later."""
    try:
        path = Path(URL_LIST)
        new = not path.exists()
        with path.open("a", encoding="utf-8") as fh:
            if new:
                fh.write("key,url\n")
            fh.write(f"{key},{storage.url(key)}\n")
    except OSError as exc:
        log(f"[WARN] could not write {URL_LIST}: {exc}")


def links_path():
    if LINKS_FILE:
        return Path(LINKS_FILE)
    slug = re.sub(r"[^0-9a-zA-Z]+", "_", S3_PREFIX).strip("_") or "links"
    return Path(f"links_{slug}.txt")


def sorted_keys(state):
    """Every finished object, episodes first and in episode order, then
    whatever had no episode number, oldest message first."""
    rows = []
    for mid, entry in state.items():
        key = (entry or {}).get("key")
        if not key:
            continue
        ep = entry.get("ep")
        try:
            mid_int = int(mid)
        except (TypeError, ValueError):
            mid_int = 0
        rows.append(((0, ep, mid_int) if isinstance(ep, int) else (1, 0, mid_int), key))
    rows.sort(key=lambda r: r[0])
    return [key for _, key in rows]


def write_links(storage, state):
    """One plain URL per line - the exact thing the Admin panel's
    "Bulk import" box wants pasted into it."""
    path = links_path()
    try:
        body = "\n".join(storage.url(key) for key in sorted_keys(state))
        path.write_text(body + ("\n" if body else ""), encoding="utf-8")
    except OSError as exc:
        log(f"[WARN] could not write {path}: {exc}")
    return path


def scan_path(chat_id):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^0-9a-zA-Z_-]", "_", str(chat_id))
    return STATE_DIR / f"scan_{safe}.json"


def filter_signature():
    """Resuming a scan is only safe while the same videos are being asked
    for - change FILTER and the older messages must be walked again."""
    return "|".join(str(x) for x in
                    (TG_TOPIC, FILTER, ONLY_IDS, SINCE, UNTIL, MIN_MB, MAX_MB, S3_PREFIX))


def load_scan(chat_id):
    p = scan_path(chat_id)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_scan(chat_id, max_id):
    p = scan_path(chat_id)
    try:
        p.write_text(json.dumps({"max_id": max_id, "filter": filter_signature()},
                                indent=1), encoding="utf-8")
    except OSError as exc:
        log(f"[WARN] could not write {p}: {exc}")


# -------------------------------------------------------------- pipeline ----

class Job:
    __slots__ = ("msg", "size", "name", "mime", "ep", "key", "local")

    def __init__(self, msg, size, name, mime):
        self.msg = msg
        self.size = size
        self.name = name
        self.mime = mime
        self.ep = episode_number(name, getattr(msg, "message", "") or "")
        self.key = build_key(msg, name, self.ep)
        self.local = TEMP_DIR / f"{msg.id}_{name}"


class Pipeline:
    """Downloaders and uploaders run at the same time: while video #2 is being
    downloaded, video #1 is already on its way to the bucket."""

    def __init__(self, pool, storage, chat_key, state):
        self.pool = pool
        self.storage = storage
        self.chat_key = chat_key
        self.state = state
        self.seen = set(state.keys())
        self.dl_q = asyncio.Queue(maxsize=TG_WORKERS * 2)
        self.up_q = asyncio.Queue(maxsize=TG_UPLOADERS + 2)
        self.lock = asyncio.Lock()
        self.tasks = []
        self.stats = {"scanned": 0, "queued": 0, "skipped": 0,
                      "stored": 0, "failed": 0}
        self.stop_reason = None
        # oldest message that failed: the saved scan position must never move
        # past it, or the next run would skip the video instead of retrying it
        self.retry_from = None

    # -- intake -------------------------------------------------------------
    async def offer(self, msg, force=False):
        """Queue a message if it is a new video we still want. Returns True
        when it was actually queued. `force` is for videos the user picked by
        hand - they have already been through the filters."""
        info = video_info(msg)
        if not info:
            return False
        size, raw_name, mime = info
        name = safe_name(raw_name)

        mid = str(msg.id)
        if mid in self.seen:
            self.stats["skipped"] += 1
            return False
        if not force:
            reason = unwanted(msg, size, name)
            if reason:
                self.stats["skipped"] += 1
                return False
        if MAX_ITEMS and self.stats["queued"] >= MAX_ITEMS:
            self.stop_reason = f"reached MAX_ITEMS={MAX_ITEMS}"
            return False

        self.seen.add(mid)
        self.stats["queued"] += 1
        job = Job(msg, size, name, mime)
        when = (msg.date or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        ep = f"  EP{job.ep}" if job.ep is not None else ""
        log(f"#{msg.id} {when}{ep}  {printable(job.name)}  {human(size)}")
        if DRY_RUN:
            return True
        await self.dl_q.put(job)
        return True

    # -- workers ------------------------------------------------------------
    def start(self):
        for i in range(TG_WORKERS):
            self.tasks.append(asyncio.create_task(self._downloader(i + 1)))
        for i in range(TG_UPLOADERS):
            self.tasks.append(asyncio.create_task(self._uploader(i + 1)))

    async def _downloader(self, n):
        while True:
            job = await self.dl_q.get()
            label = f"#{job.msg.id} "
            try:
                if await asyncio.to_thread(self.storage.exists, job.key, job.size):
                    log(f"    {label}already stored -> marking done")
                    await self._finish(job, note="existed")
                    self.stats["skipped"] += 1
                    continue
                TEMP_DIR.mkdir(parents=True, exist_ok=True)
                await download_fast(self.pool, job.msg, job.size, job.local, label)
                await self.up_q.put(job)
            except asyncio.CancelledError:
                raise
            except FloodWaitError as exc:
                self.stats["failed"] += 1
                log(f"[WAIT] Telegram asked to wait {exc.seconds}s")
                await asyncio.sleep(exc.seconds + 5)
            except Exception as exc:
                self.stats["failed"] += 1
                self.seen.discard(str(job.msg.id))     # let a re-run try again
                self._mark_retry(job)
                log(f"[ERROR] download #{job.msg.id}: {exc}")
                self._cleanup(job)
            finally:
                self.dl_q.task_done()

    async def _uploader(self, n):
        while True:
            job = await self.up_q.get()
            label = f"#{job.msg.id} "
            try:
                await asyncio.to_thread(self.storage.put, job.local, job.key,
                                        job.mime, job.size, label)
                await self._finish(job)
                self.stats["stored"] += 1
                log(f"    {label}done -> {self.storage.url(job.key)}")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.stats["failed"] += 1
                self.seen.discard(str(job.msg.id))
                self._mark_retry(job)
                log(f"[ERROR] upload #{job.msg.id}: {exc}")
            finally:
                self._cleanup(job)
                self.up_q.task_done()

    def _cleanup(self, job):
        if KEEP_LOCAL:
            return
        try:
            if job.local.exists():
                job.local.unlink()
        except OSError:
            pass

    def _mark_retry(self, job):
        mid = job.msg.id
        self.retry_from = mid if self.retry_from is None else min(self.retry_from, mid)

    async def _finish(self, job, note=None):
        entry = {"key": job.key, "size": job.size, "ep": job.ep,
                 "date": job.msg.date.isoformat() if job.msg.date else None}
        if note:
            entry["note"] = note
        async with self.lock:
            self.state[str(job.msg.id)] = entry
            snapshot = dict(self.state)
            await asyncio.to_thread(save_state, self.chat_key, self.state)
            await asyncio.to_thread(remember_url, self.storage, job.key)
            await asyncio.to_thread(write_links, self.storage, snapshot)

    async def drain(self):
        await self.dl_q.join()
        await self.up_q.join()

    async def stop(self):
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks = []


# ------------------------------------------------------------------ run -----

async def resolve_chat(client):
    raw = SOURCE_CHAT
    if not raw:
        print("[FATAL] TG_SOURCE_CHAT is empty. Run list-chats.bat to find the id.")
        sys.exit(1)
    chat_ref = int(raw) if re.fullmatch(r"-?\d+", raw) else raw
    try:
        entity = await client.get_entity(chat_ref)
    except Exception as exc:
        print(f"[FATAL] cannot open chat {raw}: {exc}")
        print("        your account must be a MEMBER of that channel/group.")
        sys.exit(1)
    title = getattr(entity, "title", None) or getattr(entity, "username", str(chat_ref))
    return raw, entity, title


async def cmd_run(client, pool, backfill=True, watch=False):
    storage = Storage()
    raw, entity, title = await resolve_chat(client)

    log(f"source: {title}  (id {raw})")
    if TG_TOPIC:
        log(f"topic:  {TG_TOPIC} only")
    if FILTER:
        log(f"filter: {FILTER}")
    log(f"target: {'local folder' if LOCAL_ONLY else S3_BUCKET + '/' + S3_PREFIX}")
    if DRY_RUN:
        log("DRY_RUN=1 -> nothing will be downloaded or stored")

    state = load_state(raw)
    log(f"already finished before: {len(state)} video(s)")

    pipe = Pipeline(pool, storage, raw, state)
    pipe.start()
    started = time.time()

    if watch:
        @client.on(events.NewMessage(chats=entity))
        async def on_new(event):
            if await pipe.offer(event.message):
                log("    (new message - picked up automatically)")

    if backfill:
        # A group with thousands of messages costs real minutes just to walk.
        # The position of the last full scan is remembered, so the next run
        # only looks at what was posted since - unless the filters changed,
        # which would mean older messages are wanted after all.
        resume_ok = not NEWEST_FIRST and not RESCAN_ALL
        scan = load_scan(raw) if resume_ok else {}
        min_id = int(scan.get("max_id", 0) or 0) if scan.get("filter") == filter_signature() else 0
        if min_id:
            log(f"resuming after message #{min_id} "
                f"(set RESCAN_ALL=1 to walk the whole history again)")

        highest = min_id
        log("scanning history...")
        # reply_to asks Telegram itself for just that topic - far less to walk
        async for msg in client.iter_messages(entity, reverse=not NEWEST_FIRST,
                                              min_id=min_id,
                                              reply_to=TG_TOPIC or None):
            pipe.stats["scanned"] += 1
            highest = max(highest, msg.id)
            if pipe.stats["scanned"] % 500 == 0:
                log(f"...scanned {pipe.stats['scanned']} messages")
            await pipe.offer(msg)
            if pipe.stop_reason:
                log(pipe.stop_reason + ", stopping the scan")
                break
        await pipe.drain()

        if resume_ok and not pipe.stop_reason and not DRY_RUN:
            mark = highest
            if pipe.retry_from is not None:
                mark = min(mark, pipe.retry_from - 1)   # come back for the failures
            save_scan(raw, mark)

        mins = (time.time() - started) / 60
        s = pipe.stats
        log("-" * 60)
        log(f"scanned {s['scanned']} messages | stored {s['stored']} | "
            f"skipped {s['skipped']} | failed {s['failed']}")
        log(f"finished in {mins:.1f} min")
        if s["stored"] or s["skipped"]:
            log(f"URL list: {URL_LIST}")
            log(f"paste into Admin -> Bulk import: {write_links(storage, state)}")
        log("re-run any time: finished videos are remembered and never re-downloaded")

    if watch:
        log("")
        log("WATCHING - every new video posted in this chat is downloaded")
        log("automatically. Leave this window open. Ctrl+C to stop.")
        try:
            await client.run_until_disconnected()
        finally:
            await pipe.drain()

    await pipe.stop()


# ------------------------------------------------------- topics / shows -----

async def cmd_topics(client):
    """List the forum topics of a group - the usual way a group keeps one show
    per topic. Prints the two settings to paste for each show."""
    from telethon.tl.functions.messages import GetForumTopicsRequest
    from telethon.tl.types import InputMessagesFilterVideo

    raw, entity, title = await resolve_chat(client)
    if not getattr(entity, "forum", False):
        log(f"{title} does not use Topics.")
        log("Use `shows` instead - it groups the videos by their file names.")
        return

    log(f"topics in {title}:")
    topics = []
    offset_date, offset_id, offset_topic = None, 0, 0
    while True:
        batch = await client(GetForumTopicsRequest(
            peer=entity, offset_date=offset_date, offset_id=offset_id,
            offset_topic=offset_topic, limit=100))
        got = [t for t in batch.topics if getattr(t, "title", None)]
        topics.extend(got)
        if len(got) < 100:
            break
        last = got[-1]
        offset_topic, offset_id = last.id, last.top_message

    print()
    print(f"{'topic id':>9}  {'videos':>7}  title")
    print("-" * 78)
    for t in topics:
        try:
            counted = await client.get_messages(entity, limit=0, reply_to=t.id,
                                                filter=InputMessagesFilterVideo)
            n = getattr(counted, "total", 0)
        except Exception:
            n = "?"
        print(f"{t.id:>9}  {str(n):>7}  {printable(t.title)}")
    print("-" * 78)
    print()
    print(" copy the two lines of the show you want into run-download.bat:")
    print()
    for t in topics[:12]:
        print(f"   set TG_TOPIC={t.id}")
        print(f"   set S3_PREFIX=anime/{slug(t.title)}/      REM {printable(t.title)}")
        print()


async def cmd_shows(client):
    """No topics? Group the videos by the show name read out of their file
    names, and print the FILTER to use for each one."""
    raw, entity, title = await resolve_chat(client)
    log(f"source: {title}  (id {raw})")
    if TG_TOPIC:
        log(f"looking inside topic {TG_TOPIC} only")
    log("reading file names (this walks the history once)...")

    groups = {}
    scanned = 0
    async for msg in client.iter_messages(entity, reply_to=TG_TOPIC or None):
        scanned += 1
        if scanned % 1000 == 0:
            log(f"...scanned {scanned} messages, {len(groups)} show(s) so far")
        info = video_info(msg)
        if not info:
            continue
        size, raw_name, _mime = info
        name = safe_name(raw_name)
        show = show_title(name, getattr(msg, "message", "") or "")
        if not show:
            show = "(no name in the file)"
        row = groups.setdefault(show.lower(), {"show": show, "n": 0, "bytes": 0,
                                               "eps": set(), "example": name})
        row["n"] += 1
        row["bytes"] += size
        ep = episode_number(name, getattr(msg, "message", "") or "")
        if ep is not None:
            row["eps"].add(ep)

    if not groups:
        log("no videos found here")
        return

    print()
    print(f"{'videos':>6}  {'episodes':>8}  {'total':>9}  show")
    print("-" * 78)
    for row in sorted(groups.values(), key=lambda r: -r["n"]):
        eps = f"{min(row['eps'])}-{max(row['eps'])}" if row["eps"] else "-"
        print(f"{row['n']:>6}  {eps:>8}  {human(row['bytes']):>9}  "
              f"{printable(row['show'])}")
    print("-" * 78)
    print()
    print(" copy the two lines of the show you want into run-download.bat:")
    print()
    for row in sorted(groups.values(), key=lambda r: -r["n"])[:12]:
        if row["show"].startswith("("):
            continue
        print(f"   set FILTER={printable(row['show'])}")
        print(f"   set S3_PREFIX=anime/{slug(row['show'])}/")
        print(f"   REM {row['n']} video(s), e.g. {printable(row['example'])}")
        print()


# ----------------------------------------------------------------- pick -----

async def cmd_pick(client, pool):
    """List the videos that are still missing and let the user choose which
    ones to download - `1-5, 8, 12`."""
    storage = Storage()
    raw, entity, title = await resolve_chat(client)
    state = load_state(raw)

    log(f"source: {title}  (id {raw})")
    log(f"looking for videos not downloaded yet (max {PICK_LIMIT})...")

    found = []
    scanned = 0
    async for msg in client.iter_messages(entity, reverse=not NEWEST_FIRST,
                                          reply_to=TG_TOPIC or None):
        scanned += 1
        if scanned % 500 == 0:
            log(f"...scanned {scanned} messages, found {len(found)}")
        info = video_info(msg)
        if not info:
            continue
        size, raw_name, _mime = info
        if str(msg.id) in state:
            continue
        name = safe_name(raw_name)
        if unwanted(msg, size, name):
            continue
        found.append((msg, size, name))
        if len(found) >= PICK_LIMIT:
            log(f"stopping at PICK_LIMIT={PICK_LIMIT}")
            break

    if not found:
        log("nothing new to download (everything here is already finished)")
        return

    print()
    print(f"{'#':>4}  {'id':>9}  {'date':<10}  {'ep':>4}  {'size':>9}  name")
    print("-" * 78)
    for i, (msg, size, name) in enumerate(found, 1):
        when = (msg.date or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        ep = episode_number(name, getattr(msg, "message", "") or "")
        print(f"{i:>4}  {msg.id:>9}  {when:<10}  {('' if ep is None else ep):>4}  "
              f"{human(size):>9}  {printable(name)}")
    print("-" * 78)
    print(" choose what to download:  1-5,8,12   or  all   (empty = cancel)")

    try:
        answer = input(" > ")
    except EOFError:
        answer = ""
    chosen = parse_selection(answer, len(found))
    if not chosen:
        log("nothing chosen - stopping")
        return

    total = sum(found[i - 1][1] for i in chosen)
    log(f"downloading {len(chosen)} video(s), {human(total)} in total")

    pipe = Pipeline(pool, storage, raw, state)
    pipe.start()
    try:
        for i in chosen:
            await pipe.offer(found[i - 1][0], force=True)
        await pipe.drain()
    finally:
        await pipe.stop()

    s = pipe.stats
    log("-" * 60)
    log(f"stored {s['stored']} | skipped {s['skipped']} | failed {s['failed']}")
    if s["stored"]:
        log(f"paste into Admin -> Bulk import: {write_links(storage, state)}")


# ---------------------------------------------------------------- links -----

def cmd_links():
    """Rebuild the paste-ready link list from what has already been stored.
    Needs no Telegram login at all."""
    if not SOURCE_CHAT:
        print("[FATAL] TG_SOURCE_CHAT is empty - it says which state file to read.")
        return 1
    storage = Storage()
    state = load_state(SOURCE_CHAT)
    if not state:
        print("[FATAL] nothing finished yet for this chat - run a download first.")
        return 1

    path = write_links(storage, state)
    urls = sorted_keys(state)
    print()
    for key in urls:
        print(storage.url(key))
    print()
    log(f"{len(urls)} link(s) also written to {path}")
    log("Admin panel -> open the show -> Bulk import -> paste -> Add")
    return 0


# ---------------------------------------------------------------- bench -----

async def cmd_bench(client, pool):
    """Measure 1 connection against TG_CONNECTIONS on a real video, so the
    speed setting can be tuned for this particular line."""
    raw, entity, title = await resolve_chat(client)
    sample_mb = env_float("BENCH_MB", 32)
    sample_max = int(sample_mb * 1024 * 1024)

    target = None
    async for msg in client.iter_messages(entity, limit=300):
        info = video_info(msg)
        if info and info[0] >= 8 * 1024 * 1024:
            target = (msg, info[0])
            break
    if not target:
        print("[FATAL] no video of at least 8MB found in the last 300 messages")
        return
    msg, size = target

    sample = min(size, sample_max)
    sample -= sample % CHUNK
    sample = max(sample, CHUNK)

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    dest = TEMP_DIR / "_bench.bin"
    log(f"benchmark on message #{msg.id} ({human(size)}), sample {human(sample)}")

    def noop(_):
        pass

    async def measure(clients):
        with open(dest, "wb") as fh:
            fh.truncate(sample)
        ranges = plan_ranges(sample, len(clients))
        t0 = time.time()
        await asyncio.gather(*[
            _fetch_range(c, msg.document, dest, a, b, noop)
            for c, (a, b) in zip(clients, ranges)
        ])
        return time.time() - t0

    try:
        one = await measure([pool.main])
        log(f"  1 connection : {one:6.1f}s  {rate(sample, one)}")

        clients = await pool.acquire(TG_CONNECTIONS)
        try:
            if len(clients) < 2:
                log("  only one connection available - nothing to compare")
                return
            many = await measure(clients)
            log(f"  {len(clients)} connections: {many:6.1f}s  {rate(sample, many)}")
            if many > 0:
                log(f"  => {one / many:.1f}x faster with TG_CONNECTIONS={len(clients)}")
                log("     still climbing? raise TG_CONNECTIONS (8 is a sane ceiling).")
        finally:
            pool.release(clients)
    finally:
        try:
            dest.unlink()
        except OSError:
            pass


# ------------------------------------------------------------- self test ----

def selftest():
    """Offline checks - no Telegram account, no network, no credentials."""
    failures = []

    def check(name, ok, detail=""):
        print(f"  {'OK  ' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
        if not ok:
            failures.append(name)

    print("plan_ranges")
    for size, parts in ((0, 4), (1, 4), (CHUNK - 1, 4), (CHUNK, 4),
                        (10 * 1024 * 1024, 1), (10 * 1024 * 1024, 4),
                        (700 * 1024 * 1024, 8), (12345678, 7), (5 * CHUNK, 16)):
        rs = plan_ranges(size, parts)
        covers = rs[0][0] == 0 and rs[-1][1] == size
        contiguous = all(rs[i][1] == rs[i + 1][0] for i in range(len(rs) - 1))
        aligned = all(a % CHUNK == 0 for a, _ in rs)
        growing = all(b > a for a, b in rs) if size else True
        check(f"size={size} parts={parts} -> {len(rs)} range(s)",
              covers and contiguous and aligned and growing)

    print("safe_name")
    check("strips path separators", safe_name("a/b\\c:d?.mp4") == "a_b_c_d?.mp4"
          or "/" not in safe_name("a/b\\c:d.mp4"))
    check("never empty", safe_name("...") == "video.mp4")
    check("caps the length", len(safe_name("x" * 400)) <= 120)

    print("human / rate")
    check("bytes", human(512) == "512B", human(512))
    check("megabytes", human(3 * 1024 * 1024) == "3.0MB", human(3 * 1024 * 1024))
    check("rate", rate(10 * 1024 * 1024, 5) == "2.0MB/s", rate(10 * 1024 * 1024, 5))

    print("episode numbers")
    for name, want in (("EP01.mp4", 1), ("ep-12.mkv", 12), ("Episode 7.mp4", 7),
                       ("One Piece - 1088.mp4", 1088), ("Naruto_220.mkv", 220),
                       ("S02E05.mp4", 5), ("part 3.mp4", 3),
                       ("\u1797\u17b6\u1782 \u17e1\u17e2.mp4", 12),
                       ("\u1797\u17b6\u1782\u1791\u17b8 9.mp4", 9),
                       ("trailer.mp4", None), ("video_2026.mp4", 2026),
                       ("clip.mp4", None)):
        got = episode_number(name)
        check(f"{name!r} -> {got}", got == want, f"wanted {want}")
    check("caption is the fallback", episode_number("aaa.mp4", "NARUTO EP 45") == 45)
    check("filename wins over caption",
          episode_number("EP03.mp4", "EP 99") == 3)

    print("show names (how one group with many shows is split)")
    for name, want in (
            ("NARUTO.SHIPPUDEN.EP01.1080p.mp4", "NARUTO SHIPPUDEN"),
            ("Naruto Shippuden - 02 [720p].mkv", "Naruto Shippuden"),
            ("One Piece - 1088.mp4", "One Piece"),
            ("[Group] Bleach_S02E05_x265.mkv", "Group Bleach"),
            ("Jujutsu Kaisen ep 12 KH dub.mp4", "Jujutsu Kaisen"),
            ("Demon Slayer 07 [1080p] KH.mp4", "Demon Slayer"),
            ("EP01.mp4", ""),
    ):
        got = show_title(name)
        check(f"{name!r} -> {got!r}", got == want, f"wanted {want!r}")
    check("two files of one show land on one name",
          show_title("NARUTO.SHIPPUDEN.EP01.1080p.mp4").lower()
          == show_title("naruto shippuden - 02 [720p].mkv").lower())
    check("caption is the fallback",
          show_title("", "Naruto Shippuden EP03") == "Naruto Shippuden")
    check("slug for the folder", slug("Naruto Shippuden!") == "naruto-shippuden",
          slug("Naruto Shippuden!"))

    print("forum topics")

    class _Head:
        def __init__(self, forum, top=None, root=None):
            self.forum_topic = forum
            self.reply_to_top_id = top
            self.reply_to_msg_id = root

    class _Msg:
        def __init__(self, head):
            self.reply_to = head

    check("message posted into a topic", topic_id(_Msg(_Head(True, None, 42))) == 42)
    check("reply inside a topic", topic_id(_Msg(_Head(True, 42, 77))) == 42)
    check("plain group message", topic_id(_Msg(_Head(False, None, 5))) is None)
    check("no reply header at all", topic_id(_Msg(None)) is None)

    print("object keys")

    class _M:
        id = 1234

    check("with an episode number",
          build_key(_M(), "EP07.mp4", 7) == f"{S3_PREFIX}ep-7/EP07.mp4",
          build_key(_M(), "EP07.mp4", 7))
    check("without one",
          build_key(_M(), "clip.mp4", None) == f"{S3_PREFIX}001234_clip.mp4",
          build_key(_M(), "clip.mp4", None))

    print("choosing videos by hand")
    for text, count, want in (("1-5,8,12", 20, [1, 2, 3, 4, 5, 8, 12]),
                              ("all", 3, [1, 2, 3]),
                              ("3 1 2", 5, [1, 2, 3]),
                              ("5-1", 9, [1, 2, 3, 4, 5]),
                              ("2,2,2", 5, [2]),
                              ("7", 3, []),
                              ("", 5, []),
                              ("junk", 5, [])):
        got = parse_selection(text, count)
        check(f"{text!r} of {count} -> {got}", got == want, f"wanted {want}")

    print("link list order (what gets pasted into the Admin panel)")

    class _Storage:
        def url(self, key):
            return "https://cdn.test/" + key

    ordered = sorted_keys({
        "50": {"key": "a/ep-2/b.mp4", "ep": 2},
        "10": {"key": "a/ep-10/b.mp4", "ep": 10},
        "30": {"key": "a/ep-1/b.mp4", "ep": 1},
        "20": {"key": "a/000020_x.mp4", "ep": None},
        "5":  {"key": "a/000005_y.mp4", "ep": None},
        "99": {"note": "no key at all"},
    })
    check("episodes in episode order, unnumbered last by id",
          ordered == ["a/ep-1/b.mp4", "a/ep-2/b.mp4", "a/ep-10/b.mp4",
                      "a/000005_y.mp4", "a/000020_x.mp4"], str(ordered))

    print("state file round-trip")
    global STATE_DIR
    STATE_DIR = TEMP_DIR / "_selftest_state"
    payload = {"12": {"key": "telegram/000012_a.mp4", "size": 7}}
    save_state(-100123, payload)
    check("saved and read back", load_state(-100123) == payload)
    check("unknown chat -> empty", load_state("nope") == {})

    print("parallel assembly (fake connections)")

    class FakeClient:
        """Serves a deterministic byte pattern, optionally failing once."""

        def __init__(self, data, fail_at=None):
            self.data = data
            self.fail_at = fail_at
            self.requests = []

        def iter_download(self, location, *, offset=0, request_size=CHUNK,
                          limit=None, **kw):
            self.requests.append((offset, limit))
            data, fail_at = self.data, self.fail_at

            async def gen():
                pos, sent = offset, 0
                while pos < len(data) and (limit is None or sent < limit):
                    if fail_at is not None and pos >= fail_at:
                        self.fail_at = None          # only fail once
                        raise IOError("simulated connection drop")
                    yield data[pos:pos + request_size]
                    pos += request_size
                    sent += 1

            return gen()

    async def assemble(size, parts, fail_at=None):
        blob = bytes((i * 7 + (i >> 8)) % 251 for i in range(size))
        dest = TEMP_DIR / "_selftest.bin"
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as fh:
            fh.truncate(size)
        seen = [0]

        def on_bytes(n):
            seen[0] += n

        ranges = plan_ranges(size, parts)
        clients = [FakeClient(blob, fail_at if i == 0 else None)
                   for i in range(len(ranges))]
        await asyncio.gather(*[
            _fetch_range(c, None, dest, a, b, on_bytes)
            for c, (a, b) in zip(clients, ranges)
        ])
        out = dest.read_bytes()
        dest.unlink()
        return out == blob, seen[0], len(ranges)

    for size, parts in ((3 * 1024 * 1024 + 12345, 4), (CHUNK, 4), (777, 3),
                        (9 * 1024 * 1024, 8)):
        ok, got, used = asyncio.run(assemble(size, parts))
        check(f"{used} connections rebuild {size} bytes exactly",
              ok and got == size, f"wrote {got}")

    ok, got, used = asyncio.run(assemble(4 * 1024 * 1024, 4, fail_at=CHUNK))
    check("a dropped connection is retried and the file still matches", ok)

    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


# ------------------------------------------------------------------ main ----

async def main():
    if MODE in ("help", "-h", "--help"):
        print(__doc__)
        return

    try:
        import cryptg  # noqa: F401
    except ImportError:
        log("[SLOW] cryptg is missing - Telegram decryption runs in pure Python.")
        log("       Install it for a big speed-up:  pip install cryptg")

    client = TelegramClient(SESSION, API_ID, API_HASH,
                            connection_retries=5, request_retries=5)
    await client.start()          # asks phone + code on the FIRST run only
    me = await client.get_me()
    log(f"logged in as {me.first_name} (@{me.username})")

    pool = ConnectionPool(client, TG_CONNECTIONS)
    try:
        if MODE == "list":
            await cmd_list(client)
        elif MODE == "topics":
            await cmd_topics(client)
        elif MODE == "shows":
            await cmd_shows(client)
        elif MODE == "pick":
            await pool.start()
            await cmd_pick(client, pool)
        elif MODE == "bench":
            await pool.start()
            await cmd_bench(client, pool)
        elif MODE == "watch":
            await pool.start()
            await cmd_run(client, pool, backfill=False, watch=True)
        elif MODE == "auto":
            await pool.start()
            await cmd_run(client, pool, backfill=True, watch=True)
        else:
            await pool.start()
            await cmd_run(client, pool, backfill=True, watch=False)
    finally:
        await pool.stop()
        await client.disconnect()


if __name__ == "__main__":
    if MODE == "selftest":
        sys.exit(selftest())
    if MODE == "links":
        sys.exit(cmd_links())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nstopped by user - progress was saved, just run it again")
