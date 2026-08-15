# ទូទាត់ស្វ័យប្រវត្តិ — ដោះស្រាយបញ្ហា "Bot អានសាររបស់ Bot មិនបាន"

## ១. មូលហេតុពិត (មិនមែនកំហុស code ទេ)

នេះជា **ច្បាប់រឹងរបស់ Telegram ខ្លួនឯង** មិនមែនជា setting ដែលបិទ/បើកបានទេ។ ក្នុង
[Telegram Bots FAQ](https://core.telegram.org/bots/faq) គេសរសេរច្បាស់ថា bot នឹង
**មិនអាចឃើញសាររបស់ bot ដទៃទេ គ្រប់ mode ទាំងអស់**។

មានន័យថា៖

- បិទ Privacy Mode → **មិនជួយ**
- ដាក់ bot ធ្វើជា admin ក្រុម → **មិនជួយ**
- ប្ដូរ bot ថ្មី → **មិនជួយ**

ដូច្នេះបើកម្មវិធី/bot ដែល forward សារ ABA ចូលក្រុម គឺជា **bot** នោះ
`aba-payment-webhook` របស់យើងនឹង **មិនទាន់ទទួលបានសារនោះជារៀងរហូត** — ហេតុនេះ
ការទូទាត់ស្វ័យប្រវត្តិមិនដើរ។

> **ចម្លើយសម្រាប់សំណួរ "ប្រើ auto-forward bot បានទេ?"**
> បើ auto-forward នោះក៏ជា **bot** ដែរ → **មិនបាន** (bot មួយ forward ទៅ bot មួយទៀត
> នៅតែជាសាររបស់ bot)។ ត្រូវប្រើវិធីណាមួយក្នុង ៤ ខាងក្រោមវិញ។

---

## ២. វិធីទាំង ៤ (ល្អបំផុតទៅរកតិចបំផុត)

| # | វិធី | ថ្លៃ | ត្រូវការ server? | ភាពជឿជាក់ |
|---|------|------|------------------|-----------|
| **A** | ទូរស័ព្ទ POST ត្រង់ទៅ `aba-notify-ingest` | ឥតគិតថ្លៃ | ទេ | ខ្ពស់ |
| **B** | Channel → Discussion Group (Telegram auto-forward) | ឥតគិតថ្លៃ | ទេ | មធ្យម |
| **C** | Userbot (គណនីមនុស្សពិត) relay | ឥតគិតថ្លៃ តែត្រូវម៉ាស៊ីនបើកជានិច្ច | បាទ | ខ្ពស់ |
| **D** | ABA PayWay Gateway API (មានស្រាប់ក្នុង project) | ត្រូវ merchant account | ទេ | **ខ្ពស់បំផុត** |

---

## វិធី A — ទូរស័ព្ទផ្ញើត្រង់មក (ណែនាំបំផុតសម្រាប់វិធីឥតគិតថ្លៃ)

**គំនិត៖ ដកចោល Telegram ចេញពីផ្លូវទាំងស្រុង។** ទូរស័ព្ទដែលមាន app ABA អាន
notification រួច POST អត្ថបទនោះមក Supabase ផ្ទាល់។ គ្មាន bot ចូលរួម → គ្មានបញ្ហា។

### ជំហាន

1. **Deploy** function ថ្មី `supabase/functions/aba-notify-ingest`
2. **Set secret** ក្នុង Supabase → Edge Functions → Secrets៖
   ```
   ABA_INGEST_SECRET = <string វែងៗ ចៃដន្យ ដែលអ្នកបង្កើតខ្លួនឯង>
   ```
3. នៅលើទូរស័ព្ទដែលមាន ABA ដំឡើង app ណាមួយដែល "អាន notification រួចផ្ញើ HTTP"៖
   *Tasker*, *MacroDroid*, *AutoNotification*, *Notification Forwarder* ។ល។
   កំណត់ឲ្យវាផ្ញើ៖

   ```
   POST https://<PROJECT-REF>.supabase.co/functions/v1/aba-notify-ingest
   Header: x-aba-ingest-secret: <ABA_INGEST_SECRET>
   Body:   {"text": "<អត្ថបទ notification ទាំងមូល>"}
   ```

   បើ app នោះដាក់ header មិនបាន → ដាក់ក្នុង URL ជំនួស៖
   `...aba-notify-ingest?secret=<ABA_INGEST_SECRET>`

   បើ app នោះផ្ញើ JSON មិនបាន → ផ្ញើអត្ថបទ​ដើម​ជា body ក៏បាន (function អាន​ទាំង​ពីរ)។

4. ក្នុង Admin Panel → Subscriptions → "ABA Auto-confirm" ដាក់ **ឈ្មោះម្ចាស់គណនី ABA**
   ដូចដែលបង្ហាញក្នុង notification ពិត (key: `aba_merchant_name`)។
5. **សាកល្បង**៖ ផ្ទេរលុយ $0.01 ទៅខ្លួនឯង រួចមើល Logs របស់ function។
   វា log រាល់ពេលថាទទួលបានអត្ថបទអ្វី និង **មូលហេតុច្បាស់លាស់** ថាហេតុអ្វីផ្គូផ្គង
   បាន/មិនបាន (`merchant_name_absent`, `no_amount`, `no_pending_row`, `ambiguous`…)។

⚠️ **សុវត្ថិភាព**៖ `ABA_INGEST_SECRET` គឺដូច password។ អ្នកណាដឹងវា អាចផ្ញើអត្ថបទក្លែងក្លាយ
ហើយទទួល VIP ដោយឥតបង់លុយ។ កុំដាក់ក្នុង git, កុំចែក។ បើបាត់ទូរស័ព្ទ → ប្ដូរវាភ្លាម។
បើ secret មិនទាន់ set → function **បដិសេធគ្រប់ request** (fail-closed) ចេតនា។

---

## វិធី B — Channel → Discussion Group

**គំនិត៖** សារដែល Telegram auto-forward ពី channel ចូល group ត្រូវបានចុះឈ្មោះថាមកពី
**channel** មិនមែនមកពី **bot** ទេ — ដូច្នេះ bot យើងក្នុង group ទទួលបាន។

### ជំហាន

1. បង្កើត **Channel** ថ្មី (private ក៏បាន)
2. ដាក់ bot forwarder របស់អ្នកទៅ post ចូល **channel នោះ** (មិនមែន group ទៀតទេ)
3. ចូល Channel → Manage → Discussion → ភ្ជាប់ **group** ដែល `aba-payment-webhook` ស្ដាប់
4. Telegram នឹង auto-forward រាល់ post ចូល group ដោយស្វ័យប្រវត្តិ
5. ផ្ញើសារសាកល្បង ១ រួច **មើល Logs** — code ថ្មី print បន្ទាត់ `[IDS]` គ្រប់សារ៖
   ```
   [IDS] chat=-100xxx senders=[777000,-100yyy] auto_forward=true text="..."
   ```
   យក `chat=` ដាក់ក្នុង `ABA_NOTIFY_GROUP_ID` និងលេខណាមួយក្នុង `senders=[...]`
   ដាក់ក្នុង `ABA_NOTIFIER_ID`។

> **ចំណាំ**៖ វិធីនេះមនុស្សភាគច្រើនរាយការណ៍ថាដើរ ប៉ុន្តែខ្ញុំមិនអាចធានា ១០០% ទេ ព្រោះ
> Telegram មិនបានសរសេរវាជាផ្លូវការ។ **សាកសាកល្បង ២ នាទី** — បើបន្ទាត់ `[IDS]`
> មិនចេញក្នុង logs សោះ មានន័យថាមិនដើរ → ប្ដូរទៅវិធី A ឬ C។

---

## វិធី C — Userbot (គណនីមនុស្សពិត)

**គំនិត៖** គណនី **មនុស្ស** អានសារ bot បាន (មានតែ bot ទេដែលអានមិនបាន)។ ដូច្នេះ
script មួយ login ជាគណនីអ្នក អានសារ រួច POST មក `aba-notify-ingest`។

ឯកសារ៖ `tools/aba-userbot-forwarder.py` (Telethon)

```bash
pip install telethon requests
export TG_API_ID=...          # ពី https://my.telegram.org
export TG_API_HASH=...
export ABA_INGEST_URL="https://<PROJECT-REF>.supabase.co/functions/v1/aba-notify-ingest"
export ABA_INGEST_SECRET="..."
export ABA_TEXT_FILTER="<ឈ្មោះម្ចាស់គណនី ABA>"
python3 tools/aba-userbot-forwarder.py
```

ដំណើរការលើកដំបូងវានឹងសួរលេខទូរស័ព្ទ + code។ បន្ទាប់មកត្រូវទុកឲ្យវា **រត់ជានិច្ច**
(VPS ថោក / Raspberry Pi / Termux)។ បើកុំព្យូទ័រ sleep → ការទូទាត់ឈប់បញ្ជាក់ស្វ័យប្រវត្តិ។

⚠️ session file ដែលវាបង្កើត = login ពេញលេញទៅគណនីនោះ។ ណែនាំឲ្យប្រើ **គណនីទី២**
មិនមែនគណនីផ្ទាល់ខ្លួន។

---

## វិធី D — ABA PayWay Gateway (ដំណោះស្រាយពិតប្រាកដ)

Project នេះ **មាន code ស្រាប់ហើយ**៖ `aba-create-transaction` + `aba-payment-callback`
(មើល `ABA_GATEWAY_SETUP_NOTE.md`)។ ត្រូវការតែ merchant account + API key ពី
ABA PayWay Integration Team។

ហេតុអ្វីវាល្អជាងគេ៖ ABA ខ្លួនឯងផ្ញើ callback មកមានលេខ transaction ពិត ហើយ code
ត្រួតពិនិត្យម្ដងទៀតជាមួយ ABA មុនផ្ដល់ VIP — **គ្មានការទាយពីចំនួនទឹកប្រាក់ទេ**។

---

## ៣. បញ្ហាដែលនៅសល់ ទោះជាវិធីណាក៏ដោយ (A/B/C)

វិធី A, B, C ទាំងបីនៅតែ **ផ្គូផ្គងតាមចំនួនទឹកប្រាក់តែមួយគត់** ព្រោះ notification ABA
មិនមានលេខយោង/note អ្វីឡើយ។ ដូច្នេះ៖

- បើ **អ្នកទិញ ២ នាក់** កំពុងទិញ plan **តម្លៃដូចគ្នា** ក្នុងពេលតែមួយ → code
  **បដិសេធមិនទាយ** (`[AMBIGUOUS]`) ហើយទាំងពីរធ្លាក់ទៅ receipt upload / admin approve។
  នេះជាការរចនាចេតនា — ទាយខុសនាំឲ្យផ្ដល់ VIP ខុសម្នាក់។
- តម្លៃ plan ត្រូវតែ **ខុសគ្នាទាំងអស់**។ បច្ចុប្បន្ន live៖ 1m=$2, 2m=$4, 6m=$7, 12m=$27 ✅

**មានតែវិធី D (PayWay) ទេដែលដោះស្រាយបញ្ហានេះជាឫសគល់** ព្រោះមាន transaction id ពិត។
បើចង់នៅឥតគិតថ្លៃ អាចប្រើល្បិចមួយ៖ ធ្វើឲ្យតម្លៃខុសគ្នាបន្តិចបន្តួចតាមអ្នកប្រើ
(ឧ. $2.00 / $2.01 / $2.02 បង្វិលវេន) — ប៉ុន្តែវាធ្វើឲ្យ QR ថេរប្រើលែងបាន។

---

## ៤. Checklist ពេលវាមិនដើរ

1. មើល **Logs** របស់ function មុនគេ (Supabase → Edge Functions → Logs)
2. គ្មានបន្ទាត់ `[IDS]` ឬ `[INGEST]` សោះ? → សារមិនទាន់មកដល់ទេ (បញ្ហា relay វិធី A/B/C)
3. `merchant_name_unset` / `merchant_name_absent`? → ដាក់/កែឈ្មោះក្នុង Admin Panel
   → Subscriptions ឲ្យត្រូវ **ដូចនឹង notification ពិត**
4. `no_amount`? → format notification ខុសពីរំពឹង — ចម្លងអត្ថបទពិតមកបង្ហាញខ្ញុំ
5. `no_pending_row`? → អ្នកទិញមិនទាន់ចុច "ចូលសមាជិក VIP" ឬលើសពី ១៥ នាទី
6. `ambiguous`? → មានអ្នកទិញច្រើននាក់ក្នុងតម្លៃដូចគ្នា (មើលផ្នែក ៣)

---

## ៥. ឯកសារដែលបានប្ដូរ/បន្ថែម

| ឯកសារ | ស្ថានភាព |
|--------|-----------|
| `supabase/functions/aba-notify-ingest/index.ts` | **ថ្មី** — HTTPS endpoint (វិធី A) |
| `supabase/functions/aba-payment-webhook/index.ts` | **កែ** — ស្គាល់ auto-forward/channel/userbot + log `[IDS]` + ទទួល ID ច្រើន (បំបែកដោយ `,`) |
| `tools/aba-userbot-forwarder.py` | **ថ្មី** — script វិធី C |
| `ABA_AUTO_CONFIRM_FORWARD_GUIDE.md` | **ថ្មី** — ឯកសារនេះ |

មិនបានប៉ះ database schema ទេ — **គ្មាន SQL ត្រូវ run** សម្រាប់ការផ្លាស់ប្ដូរនេះ។

---

# ៦. បញ្ជាក់តាមសារ ABA ពិតរបស់អ្នក (v30)

សារគំរូដែលបានផ្តល់៖

```
$2.00 paid by ROM SARY (*297) on Aug 14, 04:54 PM via ABA PAY
at PANG SOK HENG S2_Nint.Ani. Trx. ID: 178670124828004, APV: 993238.
```

បានសាកល្បង parse ជាក់ស្តែង — លទ្ធផល៖

| ចាប់បាន | តម្លៃ |
|---|---|
| ចំនួនទឹកប្រាក់ | `2.00` ✅ (ត្រូវនឹង plan $2) |
| Trx. ID | `178670124828004` ✅ |
| អ្នកបង់ | `ROM SARY (*297)` ✅ |
| ឈ្មោះ merchant | `S2_Nint.Ani` ✅ រកឃើញក្នុងសារ |

### ⚙️ តម្លៃដែលត្រូវដាក់

នៅ **Admin Panel → Subscriptions → "ABA Auto-confirm"** ដាក់៖

```
S2_Nint.Ani
```

❌ **កុំដាក់** `ROM SARY` — នោះជាឈ្មោះ**អ្នកបង់** ដែលប្ដូរគ្រប់ដង។
✅ អាចដាក់ `PANG SOK HENG` ក៏បាន តែ `S2_Nint.Ani` ជាក់លាក់ជាង។

### 🛡️ ការពារការផ្ដល់ VIP ស្ទួន (ថ្មី)

ឥឡូវប្រព័ន្ធរក្សា **Trx. ID** ទុកលើ row នីមួយៗ ហើយមាន **unique index** នៅថ្នាក់
database។ ដូច្នេះ បើ forwarder ផ្ញើសារដដែលពីរដង ឬបើទាំង Telegram webhook និង HTTPS
ingest ឃើញសារតែមួយ — លើកទីពីរនឹងត្រូវ **បដិសេធ** (`duplicate_trx`) មិនផ្ដល់ VIP ថែម
មួយខែទៀតទេ។

⚠️ ត្រូវ run `database/aba-trx-id-addition.sql` ជាមុន។ បើមិនទាន់ run —
ការទូទាត់នៅតែដំណើរការធម្មតា គ្រាន់តែបាត់ការការពារស្ទួន ហើយ log នឹងបញ្ចេញ
`[MIGRATION] Run database/aba-trx-id-addition.sql`។

---

# ៧. ការផ្លាស់ប្ដូរ UI (v30)

## លុបចេញ
- ❌ **ប៊ូតុង "បានទូទាត់រួចរាល់"** (locked) — លុបចេញទាំងស្រុងតាមការស្នើ។
  ប៊ូតុងនោះគ្រាន់តែនិយាយឡើងវិញនូវអ្វីដែល poll ដឹងស្រាប់ ហើយបង្កើតជំហានលើសមួយ។

## ជំនួសដោយ (តាមស្តង់ដារ checkout ពិត)
ពេលការទូទាត់ត្រូវបានបញ្ជាក់ → អេក្រង់ **ប្ដូរខ្លួនឯងភ្លាមៗ** ទៅ **វិក្កយបត្របញ្ជាក់**៖

- ✓ រង្វង់ខៀវបៃតង + "ការទូទាត់ជោគជ័យ"
- 📋 តារាងវិក្កយបត្រ ៤ ជួរ៖ **គម្រោង · ចំនួនទឹកប្រាក់ · លេខយោង · សុពលភាពដល់**
  (លេខយោង = Trx. ID ពិតរបស់ ABA — អតិថិជនអាច screenshot ទុកផ្ទៀងផ្ទាត់)
- 🎁 ប៊ូតុងចម្បង៖ ចាប់រង្វាន់ & មើលរឿង
- ▶️ ប៊ូតុងរង៖ ចាប់ផ្ដើមមើល

## កែពាក្យ (description)
អត្ថបទពេលរង់ចាំ ប្ដូរឲ្យច្បាស់ថា **គ្មានអ្វីត្រូវចុច**៖

> "ប្រព័ន្ធកំពុងផ្ទៀងផ្ទាត់ជាមួយធនាគារដោយស្វ័យប្រវត្តិ។ ពេលបង់រួច វានឹងដោះសោដោយខ្លួនឯងភ្លាមៗ — គ្រាន់តែកុំបិទផ្ទាំងនេះ។"

## រក្សាទុកដដែល (តាមការជ្រើសរើស)
- ✅ Tab Auto / Manual
- ✅ Upload វិក្កយបត្រ (fallback ពេល auto បរាជ័យ)
- ✅ ប៊ូតុងបើក App ABA
