# ជូនដំណឹងស្វ័យប្រវត្តិចូល VIP Group ពេលមាន Episode ថ្មី

ពេល admin បន្ថែម episode ថ្មីតាម Admin Panel ↦ Bot ផ្ញើសារចូល VIP group ដោយស្វ័យប្រវត្តិ ជាមួយប៊ូតុងចូល Mini App ត្រង់ Show នោះភ្លាម។

## ១. Deploy edge function
```bash
supabase functions deploy notify-new-episode
```
(ឬតាម Supabase Dashboard → Edge Functions → Deploy new function → paste ខ្លឹមសារ `supabase/functions/notify-new-episode/index.ts`)

## ២. កំណត់ Secrets (Supabase Dashboard → Edge Functions → Secrets)
```
TELEGRAM_BOT_TOKEN   = <token ពី @BotFather>
TELEGRAM_GROUP_ID    = <chat id របស់ VIP group, លេខអវិជ្ជមាន ដូចជា -1001234567890>
TELEGRAM_MINIAPP_URL = https://t.me/YourBotName/app   (link ដដែលពី BotFather Menu Button, មិនដាក់ ? query)
```

### របៀបរក Group ID
1. បន្ថែម bot ចូល VIP group (បើមិនទាន់)
2. ផ្ញើសារណាមួយក្នុង group
3. បើក `https://api.telegram.org/bot<TOKEN>/getUpdates` ក្នុង browser
4. រកមើល `"chat":{"id": -100xxxxxxxxxx, ...}` នោះជា Group ID

## ៣. បង្កើត Database Webhook
1. Supabase Dashboard → **Database → Webhooks** → **Create a new webhook**
2. Table: `episodes`
3. Events: **Insert** (ធីកតែ Insert)
4. Type: **HTTP Request** → POST
5. URL: `https://<PROJECT_REF>.supabase.co/functions/v1/notify-new-episode`
6. Headers: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (ចាំបាច់ ដើម្បីកុំឲ្យអ្នកក្រៅហៅ function នេះបាន)
7. Save

## របៀបដំណើរការ
Admin បន្ថែម episode ថ្មី → INSERT ចូល `episodes` table → Webhook ហៅ edge function → function រក show title → ផ្ញើសារ + ប៊ូតុង deep link ចូល VIP group ស្វ័យប្រវត្តិ។

សារនឹងបង្ហាញដូចនេះ៖
> 🎬 **[ឈ្មោះ Show]**
> EP 12 — [ចំណងជើង episode] ត្រូវបានដាក់បញ្ចូលរួចហើយ!
> [ប៊ូតុង: មើលឥឡូវនេះ 📺] → ចុចបើក Mini App ត្រង់ Show នោះភ្លាម

## Admin Chat ID ច្រើននាក់

`TELEGRAM_ADMIN_CHAT_ID` ទទួល chat id បានច្រើន ដោយបំបែកដោយ **សញ្ញាក្បៀស**៖

```
TELEGRAM_ADMIN_CHAT_ID = 123456789,7777639689
```

រាល់ id ក្នុងបញ្ជីនឹងទទួល៖ សំបុត្រទូទាត់ថ្មី (ព្រមទាំងប៊ូតុង ✅ Approve / ❌ Reject
ដែលដំណើរការគ្រប់គ្នា), ការជូនដំណឹង auto-confirm ពី ABA/Bakong, សារសង្ស័យ
mass-download, និងសារពេលមានអ្នកត្រូវ kick ចេញពី group។ ពាក្យបញ្ជា `/ban` និង
`/unban` ក៏ប្រើបានដែរគ្រប់ admin ក្នុងបញ្ជី (ចម្លើយត្រឡប់ទៅអ្នកដែលវាយ)។

ដាក់តែ id តែមួយ ក៏ដំណើរការដូចមុនដដែល។ បន្ទាប់ពីប្តូរ secret ត្រូវ **deploy
edge functions ឡើងវិញ** ដើម្បីឲ្យតម្លៃថ្មីមានប្រសិទ្ធភាព៖ `telegram-admin-bot`,
`notify-payment-submission`, `notify-suspicious-activity`, `auto-approve-payment`,
`confirm-payment-proof`, `confirm-movie-payment-proof`, `bakong-verify`,
`aba-payment-callback`, `aba-payment-webhook`, `aba-notify-ingest`។

> ចំណាំ៖ admin ថ្មីត្រូវចុច **Start** ជាមួយ bot ជាមុនសិន បើមិនដូច្នេះ Telegram
> មិនអនុញ្ញាតឲ្យ bot ផ្ញើសារទៅគាត់ទេ (error: "bot can't initiate conversation")។

## ការការពារវីដេអូ VIP (episode-stream)

មុននេះ ការត្រួតពិនិត្យ VIP ស្ថិតនៅត្រឹម browser ប៉ុណ្ណោះ ហើយ `episodes.video_url`
អាចអានបានដោយសាធារណៈ — មានន័យថាអ្នកណាក៏អាចទាញ URL វីដេអូចេញដោយប្រើ anon key
(ដែលមានស្រាប់ក្នុង app) ហើយមើលដោយមិនបង់ប្រាក់។ ឥឡូវ URL ត្រូវចេញពី server
តាម edge function `episode-stream` ដែលពិនិត្យ ២ យ៉ាង៖

1. **អ្នកណាសួរ** — ផ្ទៀងផ្ទាត់ `initData` របស់ Telegram ដោយ HMAC ជាមួយ bot token
   (មិនមែន `initDataUnsafe` ដែលអាចក្លែងបានទេ)
2. **មានសិទ្ធិមើលឬអត់** — រឿង/ភាគឥតគិតថ្លៃ សម្រាប់គ្រប់គ្នា · ភាពយន្តទិញរួច
   សម្រាប់អ្នកទិញ · ក្រៅពីនោះត្រូវមាន VIP នៅសល់ (`subscriptions.expires_at`)

### ជំហានដំឡើង (លំដាប់សំខាន់)
```bash
# ១. deploy function ជាមុនសិន
supabase functions deploy episode-stream
```
2. Deploy app (Vercel ធ្វើស្វ័យប្រវត្តិ)
3. រួចទើប run `database/protect-episode-video-url.sql` ក្នុង SQL Editor

បើ run SQL មុន deploy function វីដេអូនឹងលែងចាក់បានរហូតដល់ function ដំឡើងរួច។
Function នេះប្រើ Secret `TELEGRAM_BOT_TOKEN` ដដែល — មិនត្រូវការ secret ថ្មីទេ។

> **ស្ថានភាពគម្រោងនេះ៖ ជំហានទាំង ៣ រួចរាល់ហើយ។** `episode-stream` deploy រួច,
> app ឡើង production រួច, ហើយ SQL run រួចនៅ ២៨ សីហា ២០២៦។ ឥឡូវ role `anon`
> អានបានតែ column ផ្សេងៗ (`title`, `thumbnail_url`, …) ប៉ុណ្ណោះ — `video_url`
> ត្រូវបានបិទ ហើយ `select *` លើតារាង `episodes` ក៏ត្រូវបានបដិសេធដែរ។ រីឯ admin
> (role `authenticated`) និង edge functions (service role) នៅតែអានបានធម្មតា។
