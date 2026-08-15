# វិធី C — Userbot Relay (ជំហានម្ដងមួយៗ)

ប្រើវិធីនេះពេលមិនមានទូរស័ព្ទ Android (MacroDroid ដំណើរការតែលើ Android)។

---

## ✅ ស្ថានភាពបានបញ្ជាក់រួច (Aug 2026)

**bot "PayWay by ABA" ផ្ញើសារចូល group `ABA_NOTIFIER` រួចហើយ** — គឺជា bot ផ្លូវការ
របស់ ABA ខ្លួនឯង។ នេះជាមូលហេតុ**ពិត**ដែល auto-confirm មិនដើរ៖ bot របស់យើង
អានសាររបស់ bot ABA មិនបាន។ Userbot ដោះស្រាយបញ្ហានេះបាន ព្រោះគណនីមនុស្សអានបាន។

- **Group ID**: `-5588646530` (PayWay ខ្លួនឯងបោះពុម្ពក្នុង chat) — ដាក់ជា default រួច
- **Format សារ**: បានសាកល្បង parse នឹងសារពិត ៤ សារ — ចាប់បាន amount / Trx ID /
  payer / merchant **ត្រឹមត្រូវទាំងអស់** ✅

## ⚠️ លក្ខខណ្ឌចាំបាច់ — ត្រូវមានម៉ាស៊ីនបើក ២៤ម៉ោង

- ✅ VPS ថោក (~$4/ខែ — DigitalOcean, Vultr, Hetzner)
- ✅ Raspberry Pi នៅផ្ទះ
- ⚠️ កុំព្យូទ័រផ្ទាល់ខ្លួន — **បើ sleep ឬបិទ → ការទូទាត់ឈប់បញ្ជាក់ស្វ័យប្រវត្តិ**

---

## ជំហានទី ០ — Set Secret លើ Supabase (បើមិនទាន់)

Supabase → Edge Functions → Secrets → បន្ថែម៖

```
ABA_INGEST_SECRET = <string វែងៗ ចៃដន្យ ដែលអ្នកបង្កើត>
```

ឧទាហរណ៍បង្កើត៖ `openssl rand -hex 32`

---

## ជំហានទី ១ — យក API_ID និង API_HASH

1. ចូល https://my.telegram.org
2. Login ដោយលេខទូរស័ព្ទ Telegram របស់អ្នក
3. ចុច **API development tools**
4. បំពេញ App title / Short name (អ្វីក៏បាន ឧ. `aba-relay`)
5. ចម្លងទុក **api_id** និង **api_hash**

---

## ជំហានទី ២ — ដំឡើង

```bash
mkdir -p ~/aba-relay && cd ~/aba-relay
# ដាក់ aba-userbot-forwarder.py និង requirements.txt ក្នុងថត​នេះ
pip install -r requirements.txt
```

---

## ជំហានទី ៣ — រក Chat ID

```bash
export TG_API_ID=<api_id>
export TG_API_HASH=<api_hash>

python3 aba-userbot-forwarder.py list
```

លើកដំបូងវាសួរលេខទូរស័ព្ទ + code (Telegram ផ្ញើមក)។ បន្ទាប់មកវាបោះពុម្ពបញ្ជីទាំងអស់៖

```
              ID  TYPE       NAME
      1234567890  user       ABA Notification Bot
  -1001234567890  group      Nint Payment Alerts
```

👉 **ចម្លង ID នៃជួរ `ABA_NOTIFIER`** (គួរតែ `-5588646530` ឬ `-1005588646530`)

⚠️ សូមប្រើលេខដែល `list` បោះពុម្ព **មិនមែន**លេខដែល PayWay bot និយាយ —
Telethon ប្រើទម្រង់ផ្សេងបន្តិចម្ដងៗ។

---

## ជំហានទី ៤ — សាកដំណើរការ

```bash
export ABA_INGEST_SECRET=<secret ពីជំហានទី ០>
export ABA_SOURCE_CHATS=-5588646530   # ឬលេខពិតពី `list`
export ABA_TEXT_FILTER="S2_Nint.Ani"

python3 aba-userbot-forwarder.py
```

### 🔴 សំខាន់ — $0.01 សាកមិនបានទេ

សារសាកល្បងមុនៗរបស់អ្នកជា **$0.01** ដែល**មិនត្រូវនឹង plan ណាមួយ** →
វានឹងឆ្លើយ `no_tier_for_amount` ជានិច្ច។

**មាន ២ ជម្រើស៖**

**ក. សាកដោយថ្លៃថោក (ណែនាំ)** — Admin Panel → Subscriptions → ប្ដូរតម្លៃ plan
`១ ខែ` ពី `2` ទៅ `0.01` → Save → សាកបង់ $0.01 → **ប្ដូរត្រឡប់ទៅ `2` វិញភ្លាម**។
កុំភ្លេចប្ដូរត្រឡប់ បើមិនដូច្នេះអតិថិជនពិតបាន VIP ក្នុងតម្លៃ ១ សេន។

**ខ. សាកដោយលុយពិត** — បង់ $2 ពេញ។

**ជំហានសាកល្បង៖**
1. បើក app → ចុច **"ចូលសមាជិក VIP"** ជាមុនសិន (បង្កើត pending row —
   បើគ្មាន វានឹងឆ្លើយ `no_pending_row`)
2. ក្នុង ១៥ នាទី → បង់លុយចូល QR
3. មើល log

លទ្ធផលដែលរំពឹង៖

```
[SEEN] chat=-1001234567890 text='$2.00 paid by ...'
[RELAY] 200 {"ok":true,"matched":true,"submission_id":"...","trx_id":"178670..."}
```

`"matched": true` = **ជោគជ័យ** ✅

### បើមិនជោគជ័យ — អានលេខមូលហេតុ

| ចម្លើយ | មានន័យ | ដោះស្រាយ |
|---|---|---|
| `403 forbidden` | secret មិនត្រូវ | ពិនិត្យ `ABA_INGEST_SECRET` ២ កន្លែងឲ្យដូចគ្នា |
| `503 not_configured` | secret មិនទាន់ set លើ Supabase | ធ្វើជំហានទី ០ |
| `merchant_name_absent` | ឈ្មោះមិនរកឃើញក្នុងសារ | Admin Panel → Subscriptions |
| `no_pending_row` | មិនទាន់ចុច "ចូលសមាជិក VIP" ឬលើស ១៥ នាទី | ចុចក្នុង app មុនបង់ |
| `no_tier_for_amount` | ចំនួនទឹកប្រាក់មិនត្រូវនឹង plan ណា | ពិនិត្យតម្លៃ |
| `duplicate_trx` | សារនេះប្រើរួចហើយ | ធម្មតា — ការពារស្ទួន |
| `no_tier_for_amount` ជានិច្ច | កំពុងសាក $0.01 | អានផ្នែក "សំខាន់" ខាងលើ |
| គ្មាន `[SEEN]` សោះ | userbot មិនឃើញសារ | Chat ID ខុស — រត់ `list` ម្ដងទៀត |

---

## ជំហានទី ៥ — ឲ្យវារត់ជានិច្ច

### Linux (VPS / Raspberry Pi) — ណែនាំ

កែ `aba-relay.service` (ប្ដូរ `YOUR_LINUX_USER` និង `REPLACE_ME` ទាំងអស់) រួច៖

```bash
sudo cp aba-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aba-relay
journalctl -u aba-relay -f      # មើល log
```

⚠️ **ត្រូវរត់ដោយដៃម្ដងជាមុនសិន** (ជំហានទី ៤) ដើម្បីឲ្យ Telethon សរសេរ `.session`។
systemd ឆ្លើយសំណួរ code មិនបានទេ។

### Windows / macOS

ប្រើ `screen`, `tmux`, ឬបើក terminal ទុករហូត។ ត្រូវ**បិទ sleep**។

---

## 🔒 សុវត្ថិភាព — សូមអានឲ្យច្បាស់

- ឯកសារ `aba_relay_session.session` = **login ពេញលេញ** ទៅគណនី Telegram នោះ។
  អ្នកណាចម្លងវាបាន = login ជាអ្នក។ កុំដាក់ក្នុង git, កុំផ្ញើឲ្យអ្នកណា។
- ណែនាំប្រើ **គណនី Telegram ទី២** (លេខទូរស័ព្ទផ្សេង) មិនមែនគណនីផ្ទាល់ខ្លួន។
- `ABA_INGEST_SECRET` ដូច password — អ្នកណាដឹង អាចផ្ញើអត្ថបទក្លែងក្លាយយក VIP ឥតបង់លុយ។

---

## 📌 ចំណាំ

វិធីនេះជា **ដំណោះស្រាយបណ្ដោះអាសន្ន**។ ពេលមានទូរស័ព្ទ Android →
ប្ដូរទៅ **វិធី A (MacroDroid)** ដែលមិនត្រូវការ server, មិនត្រូវការ session file,
ហើយមិនអាស្រ័យលើថាមានអ្វីដាក់សារចូល Telegram ឬអត់។
