# របៀបតម្លើង Relay លើ VPS (Ubuntu) — រត់ ២៤ម៉ោង

**ខុសពី Windows យ៉ាងណា?** VPS ជា Linux ដូច្នេះ **គ្មានឯកសារ .bat ទេ** —
ប្រើ `run-relay.sh` និង `systemd` ជំនួស។ ជំហានផ្សេងគ្នា ប៉ុន្តែលទ្ធផលដូចគ្នា។

| | Windows | VPS (Linux) |
|---|---|---|
| ដំណើរការ | ចុចពីរដង `.bat` | `systemctl` |
| រត់ ២៤ម៉ោង | ❌ (sleep/បិទ) | ✅ |
| ចាប់ផ្ដើមឡើងវិញស្វ័យប្រវត្តិ | ❌ | ✅ |
| តម្លៃ | ឥតគិតថ្លៃ | ~$4-6/ខែ |

---

## ជំហានទី ១ — ទិញ VPS

ជម្រើសថោក (ណាមួយក៏បាន)៖ **Hetzner** (~€4), **Vultr** (~$5),
**DigitalOcean** (~$4), **Contabo** (~$5)។

ពេលបង្កើត សូមជ្រើស៖
- OS: **Ubuntu 24.04 LTS**
- ទំហំតូចបំផុត (1 vCPU / 1GB RAM) — គ្រប់គ្រាន់ហើយ
- តំបន់៖ Singapore ឬ Tokyo (ជិត Cambodia)

ក្រោយបង្កើតរួច គេឲ្យ **IP address** + **root password** មកអ្នក។

---

## ជំហានទី ២ — ចូល VPS ពី Windows

បើក **PowerShell** លើកុំព្យូទ័រ Windows របស់អ្នក រួចវាយ៖

```
ssh root@<IP-ADDRESS>
```

លើកដំបូងវាសួរ `Are you sure...?` → វាយ `yes` → រួចវាយ password។

> Password ពេលវាយ **មិនបង្ហាញអក្សរអ្វីទេ** (សូម្បីតែផ្កាយ) — នេះធម្មតា។
> គ្រាន់តែវាយរួចចុច Enter។

---

## ជំហានទី ៣ — ដំឡើងកម្មវិធី

Copy-paste ពាក្យបញ្ជានេះទាំងអស់ម្ដង៖

```bash
apt update && apt install -y python3 python3-pip python3-venv
adduser --disabled-password --gecos "" relay
mkdir -p /home/relay/aba-relay
```

> **ហេតុអ្វីបង្កើត user `relay`?** ដើម្បីកុំឲ្យ script រត់ជា root។
> បើមានអ្វីខុស វាខូចតែក្នុងថតរបស់ `relay` មិនមែនទាំង server ទេ។

---

## ជំហានទី ៤ — ដាក់ឯកសារឡើង VPS

នៅលើ **Windows PowerShell** (មិនមែនក្នុង VPS) វាយ៖

```
cd C:\aba-relay
scp aba-userbot-forwarder.py requirements.txt root@<IP-ADDRESS>:/home/relay/aba-relay/
```

រួចត្រឡប់ចូល VPS វិញ៖

```bash
cd /home/relay/aba-relay
pip3 install --break-system-packages -r requirements.txt
chown -R relay:relay /home/relay/aba-relay
```

---

## ជំហានទី ៥ — Login Telegram (ត្រូវធ្វើដោយដៃម្ដង)

🔴 **ជំហាននេះរំលងមិនបានទេ។** systemd ឆ្លើយសំណួរកូដមិនបាន ដូច្នេះត្រូវ
login ដោយដៃជាមុនសិន ដើម្បីបង្កើតឯកសារ `.session`។

```bash
su - relay
cd ~/aba-relay

export TG_API_ID=12345678
export TG_API_HASH=abcdef0123456789abcdef0123456789
export ABA_INGEST_SECRET=<secret ពី Supabase>
export ABA_SOURCE_CHATS=-5588646530
export ABA_TEXT_FILTER="S2_Nint.Ani"
export ABA_INGEST_URL=https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/aba-notify-ingest

python3 aba-userbot-forwarder.py list
```

វានឹងសួរលេខទូរស័ព្ទ + កូដ (កូដមកក្នុង app Telegram)។ រួចវាបោះពុម្ពបញ្ជី chat —
បញ្ជាក់ថា `ABA_NOTIFIER` មាន ID `-5588646530`។

រួចសាកដំណើរការពិត៖

```bash
python3 aba-userbot-forwarder.py
```

ចុច `Ctrl+C` ដើម្បីបញ្ឈប់ ពេលឃើញថាដំណើរការល្អ។

---

## ជំហានទី ៦ — ដាក់ជា service (រត់ជានិច្ច)

ចេញពី user `relay` ត្រឡប់ទៅ root៖ វាយ `exit`

```bash
nano /etc/systemd/system/aba-relay.service
```

Paste អត្ថបទនេះ (ជំនួស `REPLACE_ME` ទាំងអស់)៖

```ini
[Unit]
Description=ABA payment notification relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=relay
WorkingDirectory=/home/relay/aba-relay

Environment=TG_API_ID=REPLACE_ME
Environment=TG_API_HASH=REPLACE_ME
Environment=ABA_INGEST_SECRET=REPLACE_ME
Environment=ABA_SOURCE_CHATS=-5588646530
Environment=ABA_TEXT_FILTER=S2_Nint.Ani
Environment=ABA_INGEST_URL=https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/aba-notify-ingest

ExecStart=/usr/bin/python3 /home/relay/aba-relay/aba-userbot-forwarder.py
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
```

រក្សាទុក៖ `Ctrl+O` → Enter → `Ctrl+X`

រួច៖

```bash
systemctl daemon-reload
systemctl enable --now aba-relay
systemctl status aba-relay
```

ឃើញ **`active (running)`** ពណ៌បៃតង = ជោគជ័យ ✅

---

## មើល log

```bash
journalctl -u aba-relay -f
```

(ចុច `Ctrl+C` ដើម្បីចេញ — វាមិនបញ្ឈប់ service ទេ)

ពេលមានការទូទាត់ គួរឃើញ៖

```
[SEEN] chat=-5588646530 text='$2.00 paid by ...'
[RELAY] 200 {"ok":true,"matched":true,...}
```

---

## ពាក្យបញ្ជាចាំបាច់

| ធ្វើអ្វី | ពាក្យបញ្ជា |
|---|---|
| មើលស្ថានភាព | `systemctl status aba-relay` |
| មើល log ផ្ទាល់ | `journalctl -u aba-relay -f` |
| ចាប់ផ្ដើមឡើងវិញ | `systemctl restart aba-relay` |
| បញ្ឈប់ | `systemctl stop aba-relay` |

---

## 🔒 សុវត្ថិភាព

- ឯកសារ `aba_relay_session.session` លើ VPS = **login ពេញលេញ** ទៅគណនី
  Telegram នោះ។ ណែនាំម្ដងទៀត៖ **ប្រើគណនី Telegram ទី២** ដាច់ដោយឡែក
  ដែលបានបញ្ចូលទៅក្នុង group `ABA_NOTIFIER` — មិនមែនគណនីផ្ទាល់ខ្លួន។
- ប្ដូរ root password ភ្លាមក្រោយចូលលើកដំបូង៖ `passwd`
- កុំដាក់ឯកសារ `.service` ឬ `.session` ឡើង GitHub — មាន secret ក្នុងនោះ។
