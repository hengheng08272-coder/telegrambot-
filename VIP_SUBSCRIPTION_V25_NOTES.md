# VIP Subscription — redesign v25

## ១. អ្វីដែលបានប្តូរ (What changed)

**អេក្រង់ជ្រើសរើសគម្រោង (Plan picker)**
- ឥឡូវជា **full screen** (មិនមែន popup តូចទៀតទេ)
- ពណ៌ថ្មី៖ មាស `#F2C24B` (VIP) + ស្វាយ `#7A5CFF` (បរិយាកាស) លើផ្ទៃខ្មៅ `#07070C`
- គម្រោង **Bonus** ត្រូវបានលុបចេញពីបញ្ជី ព្រមទាំង chip "ចាប់រង្វាន់ថ្ងៃបន្ថែម" ទាំងអស់
  (ការចាប់រង្វាន់កើតឡើងក្រោយទូទាត់រួចរាល់ស្រាប់ហើយ)
- ការចុចលើគម្រោង = **ជ្រើសរើស** ប៉ុណ្ណោះ (មិនទាន់បង់ប្រាក់)
- ប៊ូតុង **"ចូលសមាជិត VIP"** ជាប់នៅខាងក្រោមអេក្រង់ជានិច្ច ជាមួយតម្លៃសរុប

**អេក្រង់ទូទាត់ (Payment screen — កន្លែងគូសក្រហម)**
- ក្រោម QR មាន caption + កន្លែង **បញ្ចូលរូបភាពវិក្កយបត្រ** (icon + ពណ៌ស្វាយ)
- Icon នាឡិកាមាន **រង្វង់រាប់ថយក្រោយ** ជាមួយ caption "កំពុងរង់ចាំទូទាត់ដោយស្វ័យប្រវត្តិ · ៣ នាទី"
- ប៊ូតុង **lock "បានទូទាត់រួចរាល់"** នៅក្រោម — បើកបានតែពេលបញ្ជាក់ការទូទាត់រួច
  (ABA ផ្គូផ្គង ឬ វិក្កយបត្របានផ្ទៀងផ្ទាត់)

**ដំណើរការ (Flow)**
1. ចុច "ចូលសមាជិត VIP" → បង្កើតសំបុត្រ + **ផ្ញើសារទៅ Telegram admin DM ភ្លាមៗ**
2. រង់ចាំ ៣ នាទី៖ បើ ABA ផ្ញើសារពិត ឬ អ្នកប្រើ upload វិក្កយបត្រ → ដោះសោ
3. បើគ្មានទាំងពីរ → **reject សំបុត្រចាស់ដោយស្វ័យប្រវត្តិ ហើយបង្កើតសំបុត្រថ្មី** (រាប់ ៣ នាទីម្តងទៀត)
   - Admin មិនទទួលសារម្តងទៀតទេ (កុំឱ្យ spam រាល់ ៣ នាទី)
   - បើ admin ចុច Approve យឺត លើសំបុត្រដែលបិទដោយស្វ័យប្រវត្តិ → **នៅតែដោះសោបាន**

## ២. ត្រូវធ្វើមុនប្រើ (Required setup)

**1) Run SQL** — Supabase → SQL Editor → paste & run:

```
database/auto-expire-submission-addition.sql
```

វាធ្វើ ៣ យ៉ាង៖
- `screenshot_url` អាចជា NULL បាន (បើអត់ធ្វើ ការចុច "ចូលសមាជិត VIP" នឹង error)
- បន្ថែម column `auto_expired`
- បង្កើត function `expire_stale_payment_submission()` (reject បានតែប៉ុណ្ណោះ — មិនអាច approve)

**2) Deploy edge functions ៣**

| Function | ហេតុអ្វី |
|---|---|
| `confirm-payment-proof` | **ថ្មីទាំងស្រុង** — កូដហៅវារួចហើយ តែវាមិនធ្លាប់មានទេ ដូច្នេះការ upload វិក្កយបត្រពីមុនមក **មិនដំណើរការ** |
| `notify-payment-submission` | ឥឡូវផ្ញើបានទោះគ្មានរូបភាព + CORS បានបើក `apikey` |
| `telegram-admin-bot` | ប៊ូតុង Approve/Reject ដំណើរការលើសារធម្មតា (មិនមែនតែរូបភាព) |

Secrets ដដែល៖ `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## ៣. ចង់យក Bonus tier មកវិញ?

`src/components/SubscriptionModal.tsx` → លុប `'2m'` ចេញពី `HIDDEN_TIER_KEYS`។

## ៤. ចង់ប្តូរពេលរង់ចាំ ៣ នាទី?

`WAIT_WINDOW_SECONDS` ក្នុងឯកសារដដែល — ហើយកែ `interval '150 seconds'` ក្នុង SQL ឱ្យតិចជាងបន្តិច។
