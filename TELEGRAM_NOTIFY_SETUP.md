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
