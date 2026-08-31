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
TELEGRAM_MINIAPP_URL = https://t.me/AnimetioMini_bot/app   (ស្រេចចិត្ត — បើមិនដាក់ ឬដាក់ខុស វាទាញឈ្មោះ bot ពី getMe ដោយខ្លួនឯង)
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
- **Enable auto-posting** — បើក/បិទ ការផុសតាមកាលវិភាគ
- **Post every (minutes)** — ចន្លោះពេលរវាងការផុសនីមួយៗ គិតជា**នាទី**
  (ឧ. `180` = រៀងរាល់ ៣ម៉ោង, `1440` = ១ដងក្នុង១ថ្ងៃ) — យ៉ាងតិច ៥ នាទី
- **Shows per post** — ចំនួនរឿងផុសម្ដងៗ (១–១០)
- **រឿងដែលត្រូវផុស** — ជ្រើសបាន ២ បែប៖
  - **តាមវេនស្វ័យប្រវត្តិ** (ដើម) — រឿងទាំងអស់ (លើកលែង Coming soon) ផ្លាស់វេនគ្នា
    រឿងណាមិនទាន់ផុសយូរជាងគេផុសមុន
  - **ជ្រើសរើសដោយខ្លួនឯង** — ផុសតែរឿងក្នុងបញ្ជីដែលបងបន្ថែម តាមលំដាប់ដែលបងរៀប
    (លេខ ១ ផុសមុនគេ) ដោយប្រើ ▲▼ ដើម្បីប្តូរលំដាប់ និង ✕ ដើម្បីដកចេញ។
    ដល់ចុងបញ្ជី វាវិលមកដើមវិញ។ រឿង Coming soon ក៏ផុសដែរ បើបងដាក់ក្នុងបញ្ជីនេះ
- **Next post in …** — ប្រាប់ថានៅសល់ប៉ុន្មាននាទីទៀតទើបផុសលើកក្រោយ
  (គិតពី "ផុសចុងក្រោយ + ចន្លោះពេល") ព្រមទាំងម៉ោងផុសចុងក្រោយ
- **Recent posts** — បញ្ជីរឿងចុងក្រោយដែល Bot ផុសរួច (ដើម្បីដឹងថាដំណើរការឬអត់)
- **Post now (test)** — សាកល្បងផុសភ្លាមៗ ដោយមិនរង់ចាំដល់ម៉ោង។ វាដំណើរការ
  ទោះបិទ **Enable auto-posting** ក៏ដោយ ហើយ**មិនប៉ះពាល់កាលវិភាគ**ទេ
  (មិនរុញម៉ោងផុសបន្ទាប់) — បើ Telegram បដិសេធ វានឹងបង្ហាញមូលហេតុពិត
  (ឧ. Bot មិនទាន់ក្នុង group, chat id ខុស)

> ចំណាំ៖ ត្រូវចុច **Save settings** មុន ទើបចន្លោះពេលថ្មីមានប្រសិទ្ធភាព។ បើមាន
> ការកែមិនទាន់រក្សាទុក Panel នឹងបង្ហាញ "Unsaved changes"។

## របៀបដំណើរការ

Cron ហៅ function រៀងរាល់នាទី → function ពិនិត្យ `enabled` និងម៉ោងផុសចុងក្រោយ →
បើដល់ពេល → ជ្រើសរើសរឿងណាដែលមិនទាន់ត្រូវផុស ឬយូរអង្វែងបំផុតតាំងពីផុសចុងក្រោយ
(មើលពី `telegram_auto_post_log`) → ផុសទៅ group → កត់ត្រាទុកក្នុង log ដើម្បីវេន
បន្ទាប់ជ្រើសរើសរឿងផ្សេង → ធ្វើបច្ចុប្បន្នភាព `last_run_at` (តែពេលផុសតាម
កាលវិភាគប៉ុណ្ណោះ ទេពេលចុច "Post now")។

## បើវាមិនដំណើរការ (troubleshooting)

| រោគសញ្ញា | មូលហេតុ / ដំណោះស្រាយ |
| --- | --- |
| Panel បង្ហាញ "Table telegram_auto_post_settings not found" | មិនទាន់ run migration — ចម្លង `database/telegram-auto-post-addition.sql` ទៅ SQL Editor |
| ចុច Save ហើយតម្លៃត្រឡប់មកវិញដដែល | ត្រូវ run migration ជាថ្មី (វាមាន policy `admin_insert_telegram_auto_post_settings` ថ្មី) ហើយ login ជា admin (`profiles.is_admin = true`) |
| "Post now" បង្ហាញ `Skipped: no_shows` | រឿងទាំងអស់ត្រូវបានដាក់ **Coming soon** |
| "Post now" បង្ហាញ `រំលង៖ បញ្ជីរឿង...នៅទទេ` | បើក «ជ្រើសរើសដោយខ្លួនឯង» តែមិនទាន់បន្ថែមរឿង |
| "Post now" បង្ហាញ Telegram refused … | មើលសារ៖ ភាគច្រើន Bot មិនទាន់ជាសមាជិក group ឬ `TELEGRAM_GROUP_ID` ខុស |
| ផុសបានពេលចុច test តែមិនផុសតាមម៉ោង | ភ្លេចបើក **Enable auto-posting** ឬ cron job មិនទាន់ដំឡើង (ផ្នែកទី ៣) |
