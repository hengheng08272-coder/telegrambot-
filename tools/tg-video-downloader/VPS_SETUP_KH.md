# រត់ Tool លើ VPS (លឿនជាង + មិនបាច់បើកកុំព្យូទ័រចោល)

ហេតុអ្វីត្រូវ VPS៖ internet ផ្ទះកំណត់ត្រឹម ~1.6MB/s (EP មួយ ~៦ នាទី)។
VPS នៅ Singapore ជាធម្មតាបាន **10–50MB/s** — លឿនជាង **១០ ដល់ ៣០ដង** ហើយវា
រត់ ២៤ម៉ោង ដោយមិនបាច់បើកកុំព្យូទ័រចោល។

> អ្នកមាន VPS រួចហើយ (`194.233.68.31` — ដែល `s3.nintanime.com` ដំណើរការ)។
> អាចប្រើវាតែម្តងបាន មិនបាច់ទិញថ្មីទេ។

---

## ជំហាន ១ — ចូល VPS

**Windows 10/11** បើក **PowerShell** (ចុច Start → វាយ `powershell`) រួច៖

```powershell
ssh root@194.233.68.31
```

**លើកដំបូង វានឹងសួរបែបនេះ៖**
```
The authenticity of host '194.233.68.31' can't be established.
ECDSA key fingerprint is SHA256:...
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```
វាយ **`yes`** រួច Enter — **តែពាក្យនេះទេ**។

បន្ទាប់មកវាសួរ password → វាយចូល (អក្សរមិនបង្ហាញទេ ជារឿងធម្មតា) → Enter

### ⚠️ ត្រូវឃើញ prompt ប្តូរជាមុនសិន

| មុនចូល (Windows) | ក្រោយចូល (VPS) |
|---|---|
| `PS C:\Users\xxx>` | `root@vmi123456:~#` |

**កុំ paste command ណាមួយ ដរាបណា prompt នៅតែជា `PS C:\...`** — បើ paste
ពេលនោះ បន្ទាត់ដំបូងនឹងក្លាយជាចម្លើយឱ្យសំណួរ `yes/no` (ចម្លើយខុស → ដាច់)
ហើយបន្ទាត់ដែលនៅសល់នឹងរត់លើ Windows ដែលគ្មាន `apt` → `'apt' is not recognized`។

> បើមិនចេះ password សូមមើលក្នុង email ពី VPS provider ឬ reset វាក្នុង
> control panel របស់ពួកគេ។

---

## ជំហាន ២ — ដំឡើងអ្វីដែលត្រូវការ

```bash
apt update
apt install -y python3 python3-pip python3-venv git screen
```

---

## ជំហាន ៣ — យក tool មកដាក់

```bash
cd /root
git clone -b claude/telegram-video-download-tool-1wipe1 \
  https://github.com/hengheng08272-coder/telegrambot-.git
cd telegrambot-/tools/tg-video-downloader
```

ដំឡើង package ក្នុង venv (កុំឱ្យប៉ះពាល់ python របស់ប្រព័ន្ធ)៖

```bash
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install telethon boto3 cryptg
```

> `cryptg` សំខាន់ណាស់លើ VPS — បើគ្មានវា CPU នឹងក្លាយជាឧបសគ្គជំនួស internet។

---

## ជំហាន ៤ — រៀបចំ setting

```bash
cp run-download.sh.template run-download.sh
chmod +x run-download.sh
nano run-download.sh
```

បំពេញ (ដូចក្នុង `run-download.bat` លើ Windows)៖

```bash
export TG_API_ID=32578084
export TG_API_HASH=<api_hash>
export TG_SOURCE_CHAT=-1004468850700

export AWS_ACCESS_KEY_ID=<R2 key>
export AWS_SECRET_ACCESS_KEY=<R2 secret>
export S3_BUCKET=nintplex
export S3_PREFIX=anime/martial-god-asura/
export S3_ENDPOINT=https://bfab9e91cee348592971b47dd5d81bd7.r2.cloudflarestorage.com
export AWS_REGION=auto
export PUBLIC_BASE_URL=https://pub-bcf65f55933b43c2ba9c3ade27baf0df.r2.dev/

export TG_TOPIC=31
```

**រក្សាទុក nano៖** `Ctrl+O` → `Enter` → `Ctrl+X`

---

## ជំហាន ៥ — Login Telegram (១ ដងគត់)

```bash
./run-download.sh list
```

- វាសួរលេខទូរស័ព្ទ → `+855xxxxxxxxx`
- Telegram ផ្ញើ code មក app Telegram របស់អ្នក → វាយចូល
- (បើមាន 2FA → វាយ password)

វានឹងបោះពុម្ព chat ទាំងអស់ = login ជោគជ័យ ✅

> បន្ទាប់ពីនេះ file `tg_downloader.session` ត្រូវបានបង្កើត — លែងសួរទៀត។

---

## ជំហាន ៦ — វាស់ល្បឿនមុន

```bash
./run-download.sh bench
```

ប្រៀបធៀបនឹង 1.6MB/s លើកុំព្យូទ័រផ្ទះ។ បើ VPS បាន 10MB/s+ នោះលឿនជាង ៦ដង។

---

## ជំហាន ៧ — រត់ក្នុង `screen` (សំខាន់!)

បើរត់ធម្មតា ពេលបិទ PowerShell ការទាញនឹងឈប់។ `screen` ដោះស្រាយបញ្ហានេះ៖

```bash
screen -S tg          # បង្កើត session ឈ្មោះ tg
./run-download.sh     # ចាប់ផ្តើមទាញ
```

**ចាកចេញដោយទុកឱ្យវារត់បន្ត៖** ចុច `Ctrl+A` រួច `D`
ឥឡូវបិទ PowerShell ក៏បាន — វានៅតែទាញបន្ត។

**ត្រឡប់មកមើលវិញ៖**
```bash
ssh root@194.233.68.31
screen -r tg
```

**បញ្ឈប់៖** ចូល `screen -r tg` រួចចុច `Ctrl+C`

---

## ជំហាន ៨ — យក link ទៅដាក់ក្នុង app

```bash
./run-download.sh links
```
វាបោះពុម្ព URL ទាំងអស់ → **ដាក់ mouse អូសយក → ចុច right-click ដើម្បី copy**
→ paste ចូល Admin panel → Bulk import

ឬទាញ file មកកុំព្យូទ័រ (រត់ក្នុង **PowerShell លើកុំព្យូទ័រ** មិនមែនក្នុង VPS)៖
```powershell
scp root@194.233.68.31:/root/telegrambot-/tools/tg-video-downloader/links_*.txt .
```

---

## ធ្វើឱ្យវាទាញស្វ័យប្រវត្តិ ២៤ម៉ោង (ជាជម្រើស)

ឱ្យវាចាំ Ep ថ្មីរហូត ទោះ VPS restart ក៏ចាប់ផ្តើមឯង៖

```bash
cat > /etc/systemd/system/tg-downloader.service <<'UNIT'
[Unit]
Description=Telegram video downloader
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/telegrambot-/tools/tg-video-downloader
ExecStart=/root/telegrambot-/tools/tg-video-downloader/run-download.sh auto
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now tg-downloader
```

**មើល log៖** `journalctl -u tg-downloader -f`
**បញ្ឈប់៖** `systemctl stop tg-downloader`

> ធ្វើវាបានតែ**ក្រោយពី login រួចហើយ** (ជំហាន ៥) ព្រោះ systemd មិនអាចវាយ code ជំនួសអ្នកបានទេ។

---

## ពិនិត្យ disk

```bash
df -h /
```

File បណ្ដោះអាសន្នរស់នៅត្រឹមពេល upload ប៉ុណ្ណោះ (លុបភ្លាមក្រោយរួច) ដូច្នេះ
ត្រូវការទំហំប្រហែល `TG_WORKERS × ទំហំ file` = ~2GB ជាការគ្រប់គ្រាន់។
បើ disk ជិតពេញ បន្ថយ `TG_WORKERS`។

---

## បញ្ហាដែលអាចជួប

| សារ | ដោះស្រាយ |
|---|---|
| `Host key verification failed` | អ្នកមិនបានវាយ `yes` ពេលវាសួរលើកដំបូង — ssh ម្តងទៀត រួចវាយ `yes` |
| `'apt' is not recognized` | អ្នក paste command ពេលនៅលើ Windows — ត្រូវចូល VPS ឱ្យឃើញ `root@...#` សិន |
| `Permission denied (publickey)` | password ខុស ឬ VPS បិទ password login — ប្រើ SSH key |
| `command not found: screen` | `apt install -y screen` |
| `[SLOW] cryptg is missing` | `./venv/bin/pip install cryptg` |
| `database is locked` | tool កំពុងរត់ពីរកន្លែងលើ session ដដែល — បញ្ឈប់មួយ |
| ល្បឿននៅតែយឺត | VPS នោះ line យឺត — សាក provider ផ្សេង (Singapore) |

---

## ⚠️ សុវត្ថិភាព

`tg_downloader.session` លើ VPS = **login Telegram ពេញលេញ**។ អ្នកណាចូល VPS បាន
គឺចូល Telegram អ្នកបាន។ ដូច្នេះ៖

- ដាក់ password VPS ឱ្យខ្លាំង (ឬប្រើ SSH key ជំនួស)
- កុំចែក password VPS ឱ្យអ្នកណា
- `run-download.sh` ផ្ទុក R2 key — កុំ `git add` វា (`.gitignore` ការពាររួចហើយ)
