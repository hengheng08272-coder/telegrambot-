# ផុសរឿងស្វ័យប្រវត្តិចូល Group (Telegram Auto-Post)

Bot នឹងផុសរឿងចូល VIP group ស្វ័យប្រវត្តិ តាមរយៈពេលកំណត់ (ឧ. រៀងរាល់ ៣ម៉ោង) ដោយ
ជ្រើសរើសរឿងឡើងវិញជានិច្ច (មិនផុសដដែលៗទេ, រង់ចាំរឿងផ្សេងទៀតបានវេនសិន) — ម្ដងៗ
ផុសបាន ១ ដល់ ១០ រឿង ស្រេចតែកំណត់។ ក្នុងសារនីមួយៗមាន៖

- 🖼️ Poster
- 🎬 ចំណងជើងរឿង
- 📝 សង្ខេបសាច់រឿង
- 📺 ភាគដែលកំពុងចាក់ដល់ (ឬ "ភាពយន្តពេញមួយ" ចំពោះភាពយន្ត)
- 🔘 ប៊ូតុង "ចូលទស្សនា" → បើក Mini App ត្រង់រឿងនោះភ្លាម

## ១. Run database migration
```sql
-- copy ខ្លឹមសារ database/telegram-auto-post-addition.sql ទៅ run
-- ក្នុង Supabase Dashboard → SQL Editor
```

## ២. Deploy edge function
```bash
supabase functions deploy telegram-auto-post
```
(ឬតាម Supabase Dashboard → Edge Functions → Deploy new function → paste
ខ្លឹមសារ `supabase/functions/telegram-auto-post/index.ts`)

Function នេះប្រើ Secrets ដូចគ្នានឹង `notify-new-episode` រួចហើយ (មើល
`TELEGRAM_NOTIFY_SETUP.md`)៖
```
TELEGRAM_BOT_TOKEN
TELEGRAM_GROUP_ID
TELEGRAM_MINIAPP_URL = https://t.me/AnimetioMini_bot/App
```

## ៣. តាំង Cron job (ហៅ function រៀងរាល់នាទី)

Function ខ្លួនឯងនឹងសម្រេចថាដល់ពេលផុសឬនៅ (ប្រៀបធៀបនឹងម៉ោងផុសចុងក្រោយ +
ចន្លោះពេលដែលកំណត់ក្នុង Admin Panel) ដូច្នេះ cron គ្រាន់តែហៅរាល់នាទីទៅ —
មិនចាំបាច់កែ cron ពេលប្តូរចន្លោះពេលនោះទេ។

Supabase Dashboard → **Database → Extensions** → បើក `pg_cron` និង `pg_net`
(បើមិនទាន់) បន្ទាប់មក **SQL Editor** → run៖

```sql
select cron.schedule(
  'telegram-auto-post-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-auto-post',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

ជំនួស `<PROJECT_REF>` និង `<SUPABASE_SERVICE_ROLE_KEY>` ដោយតម្លៃពិតរបស់អ្នក
(Project Settings → API)។

## ៤. កំណត់ក្នុង Admin Panel

Admin Panel → ប៊ូតុង **Telegram Auto-Post** (ក្បែរ Watch log)៖
- **Enable auto-posting** — បើក/បិទ
- **Post every (minutes)** — ចន្លោះពេលរវាងការផុសនីមួយៗ (ឧ. `180` = រៀងរាល់ ៣ម៉ោង)
- **Shows per post** — ចំនួនរឿងផុសម្ដងៗ
- **Post now (test)** — សាកល្បងផុសភ្លាមៗ ដោយមិនរង់ចាំដល់ម៉ោង ដើម្បីតេស្តមើលថា
  Bot, Group ID, និង poster/caption ត្រឹមត្រូវឬអត់

## របៀបដំណើរការ

Cron ហៅ function រៀងរាល់នាទី → function ពិនិត្យ `enabled` និងម៉ោងផុសចុងក្រោយ →
បើដល់ពេល → ជ្រើសរើសរឿងណាដែលមិនទាន់ត្រូវផុស ឬយូរអង្វែងបំផុតតាំងពីផុសចុងក្រោយ
(មើលពី `telegram_auto_post_log`) → ផុសទៅ group → កត់ត្រាទុកក្នុង log ដើម្បីវេន
បន្ទាប់ជ្រើសរើសរឿងផ្សេង។
