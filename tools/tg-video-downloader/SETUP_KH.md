# ទាញយក Video ពី Telegram ស្វ័យប្រវត្តិ — ការណែនាំ

ឧបករណ៍នេះ scan គ្រប់ message ក្នុង group/channel មួយ ទាញយក **video ទាំងអស់**
រួចរក្សាទុក (ក្នុង folder ឬ upload ទៅ S3/R2) ហើយអាច **នៅចាំបន្ត** — video ថ្មី
ណាដែលគេផុសចូល group វានឹងទាញយកភ្លាមដោយស្វ័យប្រវត្តិ។

**សំខាន់៖** វា login ជា **គណនីផ្ទាល់ខ្លួន** របស់អ្នក (userbot មិនមែន bot ទេ)
ព្រោះ bot ទាញយកបានត្រឹម 20MB។ គណនីអ្នកត្រូវតែជាសមាជិកក្នុង group នោះ។

---

## ១. ដំឡើង

បើមិនទាន់មាន Python៖ https://www.python.org/downloads/ →
**ត្រូវធីក `Add python.exe to PATH`** ពេលដំឡើង។

រួចហើយ double-click **`install-windows.bat`**។ វានឹង៖
- ដំឡើង `telethon` + `boto3`
- ដំឡើង **`cryptg`** (សំខាន់ណាស់សម្រាប់ល្បឿន — មើលផ្នែក "ល្បឿន" ខាងក្រោម)
- បង្កើត **`run-download.bat`** ពី template (file នេះផ្ទុក key របស់អ្នក ដូច្នេះ
  វាមិនត្រូវបានដាក់ក្នុង git ទេ)

## ២. យក API ID / API HASH

1. ចូល https://my.telegram.org → login ដោយលេខទូរស័ព្ទ Telegram របស់អ្នក
2. ចុច **API development tools** → បង្កើត app មួយ (ដាក់ឈ្មោះអ្វីក៏បាន)
3. ចម្លង **api_id** និង **api_hash** ដាក់ក្នុង `run-download.bat`

> បើអ្នកធ្លាប់ធ្វើ relay ABA រួច — គឺជាតម្លៃដដែល អាចយកមកប្រើឡើងវិញបាន។

## ៣. រក id របស់ group

double-click **`list-chats.bat`**។
- លើកដំបូង វានឹងសួរលេខទូរស័ព្ទ + code ដែល Telegram ផ្ញើមក (វាយចូល ១ ដងគត់)
- វានឹងបោះពុម្ព chat ទាំងអស់ជាមួយ id
- ចម្លង id ដែលចង់បាន (ជាធម្មតាចាប់ផ្ដើមដោយ `-100...`) → ដាក់ក្នុង
  `TG_SOURCE_CHAT` ក្នុង `run-download.bat`

## ៤. ជ្រើសរើសកន្លែងរក្សាទុក

### ក. រក្សាទុកក្នុងកុំព្យូទ័រ (ងាយស្រួលបំផុត)
ទុក `S3_BUCKET=` **ទទេ** — video នឹងចូល folder `downloads` (កែបានតាម `SAVE_DIR`)។

### ខ. Upload ទៅ S3 / R2 / Wasabi / Spaces / MinIO

| Provider | `S3_ENDPOINT` | `AWS_REGION` |
|---|---|---|
| Cloudflare R2 | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | `auto` |
| Wasabi | `https://s3.ap-southeast-1.wasabisys.com` | `ap-southeast-1` |
| DO Spaces | `https://sgp1.digitaloceanspaces.com` | `sgp1` |
| MinIO / VPS ផ្ទាល់ | domain របស់អ្នក + `S3_ADDRESSING=path` | អ្វីក៏បាន |
| AWS S3 | ទុកទទេ | `ap-southeast-1` |

**Cloudflare R2 (ណែនាំ — គ្មានថ្លៃ egress):**
1. Cloudflare dashboard → R2 → Create bucket
2. R2 → Manage API Tokens → Create token → **Object Read & Write**
3. យក Access Key ID + Secret Access Key និង Account ID (សម្រាប់ endpoint)
4. បើចង់ឱ្យ video ចាក់បានផ្ទាល់៖ bucket → Settings → Public access
   ឬភ្ជាប់ custom domain រួចដាក់ URL នោះក្នុង `PUBLIC_BASE_URL`

## ៥. រត់

| File | ធ្វើអ្វី |
|---|---|
| **`run-download.bat`** | ទាញយក video ចាស់ទាំងអស់ក្នុង group រួចឈប់ |
| **`run-topics.bat`** | បង្ហាញ **Topics** ក្នុង group (រឿង ១ ក្នុង topic ១) + ចំនួន video |
| **`run-shows.bat`** | បែងចែក video តាម **ឈ្មោះរឿង** (សម្រាប់ group គ្មាន topic) |
| **`run-pick.bat`** | **បង្ហាញបញ្ជី video រួចឱ្យអ្នកជ្រើសរើស** ថាចង់ទាញមួយណាខ្លះ |
| **`run-watch.bat`** | ទាញយកចាស់ទាំងអស់ **រួចនៅចាំបន្ត** — video ថ្មីណាចូល ទាញភ្លាម (ស្វ័យប្រវត្តិ) |
| **`run-links.bat`** | បោះពុម្ព link ទាំងអស់ សម្រាប់ paste ចូល Admin panel |
| **`run-bench.bat`** | វាស់ល្បឿន ១ connection ធៀបនឹងច្រើន connection |
| **`list-chats.bat`** | បង្ហាញ chat + id |

សម្រាប់ការទាញស្វ័យប្រវត្តិរយៈពេលវែង៖ បើក **`run-watch.bat`** ហើយទុក window នោះ
បើកចោល (ឬដាក់លើ VPS — មើលផ្នែកខាងក្រោម)។ បិទហើយបើកឡើងវិញក៏បាន វាចាំថា
file ណាធ្វើរួចហើយ។

---

## ជ្រើសរើស video ដែលចង់ទាញ (មិនចាំបាច់ទាញទាំងអស់)

### ក. ជ្រើសដោយដៃ — `run-pick.bat`

វានឹង scan រួចបង្ហាញតារាង៖

```
   #         id  date          ep       size  name
------------------------------------------------------------------------------
   1  102934567  2026-08-01     1     412.5MB  NARUTO EP01.mp4
   2  102934571  2026-08-02     2     398.1MB  NARUTO EP02.mp4
   3  102934590  2026-08-02             15.2MB  trailer.mp4
------------------------------------------------------------------------------
 choose what to download:  1-5,8,12   or  all   (empty = cancel)
 >
```

វាយ `1-2` ឬ `1,3` ឬ `all` រួច Enter — វាទាញតែអ្វីដែលអ្នកជ្រើស។

### ខ. **រឿងច្រើនក្នុង group តែមួយ — ធ្វើម្ដងមួយរឿង** ⭐

មានវិធី ២ អាស្រ័យលើថា group បែងចែករឿងបែបណា។

#### វិធីទី ១ — Group ប្រើ **Topics** (រឿង ១ ក្នុង topic ១)

double-click **`run-topics.bat`**៖

```
 topic id   videos  title
------------------------------------------------------------------------------
        2      124  Naruto Shippuden
      145       87  One Piece
      302       26  Jujutsu Kaisen
------------------------------------------------------------------------------
 copy the two lines of the show you want into run-download.bat:

   set TG_TOPIC=145
   set S3_PREFIX=anime/one-piece/      REM One Piece
```

ចម្លង ២ បន្ទាត់នោះចូល `run-download.bat` រួច double-click វា — វានឹងទាញ
**តែរឿងនោះ** ហើយបង្កើត `links_anime_one_piece.txt` ដាច់ដោយឡែក។

> **បើឈ្មោះរឿងចេញជាប្រអប់ □□□□ ក្នុង Command Prompt** — នេះជារឿងធម្មតា៖
> Windows console មិនអាចគូរអក្សរខ្មែរបានទេ (មិនមែន bug ទេ)។
>
> ដូច្នេះ `run-topics.bat` **បើក `topics.html` ក្នុង browser ដោយស្វ័យប្រវត្តិ**
> នៅពេលរួចរាល់ — ទីនោះឈ្មោះខ្មែរអានបានច្បាស់ ១០០%។ (បើវាមិនបើកឯងទេ ចូល folder
> រួច double-click `topics.html`។ មាន `topics.txt` ផងដែរ ប៉ុន្តែ Notepad ខ្លះ
> នៅតែបង្ហាញជាប្រអប់ ព្រោះ font `Consolas` គ្មានអក្សរខ្មែរ។)
>
> រឿងណាដែលឈ្មោះជាភាសាខ្មែរសុទ្ធ (គ្មានអក្សរឡាតាំង) នឹងបាន folder ជា
> `anime/topic-<លេខ>/` ដើម្បីកុំឱ្យរឿងច្រើនលាយចូល folder តែមួយ។ អ្នកអាចកែ
> `S3_PREFIX` នោះទៅជាឈ្មោះដែលអ្នកចង់បានដោយដៃ ឧ. `anime/slay-the-gods/`។

> Topic គឺជាវិធីល្អបំផុត ព្រោះ Telegram ខ្លួនឯងជាអ្នកជ្រើស — មិនចាំបាច់ដើរ
> មើលសារទាំងអស់ក្នុង group ទេ ដូច្នេះ**លឿនជាងច្រើន**។

#### វិធីទី ២ — Group គ្មាន topic (រឿងច្រើនលាយគ្នា)

double-click **`run-shows.bat`** — វាអានឈ្មោះ file ទាំងអស់រួចដាក់ជាក្រុម
(និងសរសេរចូល **`shows.txt`** ដែលបើកដោយ Notepad អានបានច្បាស់)៖

```
videos  episodes      total  show
------------------------------------------------------------------------------
   124     1-124     48.2GB  Naruto Shippuden
    87   1001-1088   33.9GB  One Piece
    26      1-26     9.10GB  Jujutsu Kaisen
------------------------------------------------------------------------------
 copy the two lines of the show you want into run-download.bat:

   set FILTER=One Piece
   set S3_PREFIX=anime/one-piece/
   REM 87 video(s), e.g. One Piece - 1001.mp4
```

ចម្លង ២ បន្ទាត់នោះចូល `run-download.bat` រួច run។ បើឈ្មោះរឿងខុសបន្តិច
(ឧ. រឿងដែលមានលេខនៅចុងឈ្មោះ) កែ `FILTER` ដោយដៃបាន។

**ធ្វើម្ដងមួយរឿងរហូត៖** ប្តូរ `TG_TOPIC` (ឬ `FILTER`) + `S3_PREFIX` → run →
paste link ចូល Bulk import របស់រឿងនោះ → បន្តរឿងបន្ទាប់។

### គ. ជ្រើសដោយលក្ខខណ្ឌផ្សេងទៀត

| ជួរក្នុង `run-download.bat` | អត្ថន័យ | ឧទាហរណ៍ |
|---|---|---|
| `TG_TOPIC` | យកតែ topic នេះ (លេខពី `run-topics.bat`) | `set TG_TOPIC=145` |
| `FILTER` | យកតែ file/caption ដែលមានពាក្យនេះ (regex ក៏បាន) | `set FILTER=naruto` |
| `ONLY_IDS` | យកតែ message id ទាំងនេះ | `set ONLY_IDS=102934567,102934571` |
| `SINCE` / `UNTIL` | យកតែក្នុងចន្លោះកាលបរិច្ឆេទ | `set SINCE=2026-08-01` |
| `MIN_MB` / `MAX_MB` | យកតែទំហំក្នុងចន្លោះនេះ (រំលង trailer/clip) | `set MIN_MB=50` |
| **`FROM_EP`** | **យកតែចាប់ពីភាគនេះឡើងទៅ** (បន្តពីអ្វីដែលមានក្នុង app) | `set FROM_EP=11` |
| `TO_EP` | យកតែដល់ភាគនេះ | `set TO_EP=20` |

### ឃ. បន្ត Ep ពីកន្លែងដែលឈប់ ⭐

ក្នុង Admin panel មាន Ep ដល់ **១០** ហើយចង់បន្តពី **១១** ទៅ? ដាក់៖

```bat
set TG_TOPIC=31
set S3_PREFIX=anime/martial-god-asura/
set FROM_EP=11
```

វានឹងទាញតែ EP11, EP12, EP13... ដោយរំលង EP1–10 ចោល។ ចង់យកត្រឹមចន្លោះណាមួយ
ដាក់ `TO_EP` ថែម (ឧ. `FROM_EP=11` + `TO_EP=20` = យកតែ ១១ ដល់ ២០)។

> ចំណាំ៖ ពេលដាក់ `FROM_EP`/`TO_EP` នោះ file ណាដែល**អានលេខភាគមិនបាន**
> (ឧ. `trailer.mp4`) ត្រូវបានរំលងទាំងអស់ — ព្រោះមិនដឹងថាវាជាភាគទីប៉ុន្មាន។

**វិធីផ្សេងទៀត៖** `run-pick.bat` ក៏បង្ហាញលេខភាគក្នុងតារាងដែរ ដូច្នេះអ្នកអាច
ជ្រើសដោយដៃបាន (ឧ. វាយ `11-20`)។

---

## ទាញ link ចូល Mini App Admin ដើម្បីបញ្ចូល Ep

Admin panel មាន **"Bulk import"** ស្រាប់ (បើករឿង → រំកិលចុះ → **Bulk import**)។
Tool នេះរៀបចំ link ឱ្យស្រាប់សម្រាប់ប្រអប់នោះ៖

1. **ឈ្មោះ file លើ storage មានលេខភាគ** — tool អាន `EP01`, `Episode 7`,
   `S02E05`, `One Piece - 1088`, `ភាគ ១២` (លេខខ្មែរក៏បាន) ពីឈ្មោះ file ឬពី
   caption រួចដាក់ key ជា `<prefix>ep-12/<file>.mp4`។
   Admin panel អានលេខ `12` ចេញពី `/ep-12/` នោះដោយស្វ័យប្រវត្តិ។
2. **File `links_<prefix>.txt`** ត្រូវបានសរសេររាល់ពេលមាន video រួចរាល់ —
   ១ URL ក្នុង ១ បន្ទាត់ តម្រៀបតាមលេខភាគ។
3. បើកវា (ឬ double-click **`run-links.bat`** ដើម្បីបោះពុម្ពម្ដងទៀត) →
   **Ctrl+A, Ctrl+C** → Admin panel → បើករឿង → **Bulk import** → **Ctrl+V**
   → ជ្រើស **keep** (ព្រោះ key មានលេខភាគស្រាប់) → មើល preview → **Add**។

> បើឈ្មោះ file គ្មានលេខភាគទាល់តែសោះ — link ទាំងនោះនៅចុងបញ្ជី តម្រៀបតាមលំដាប់
> ដែលគេផុសក្នុង group។ ពេលនោះជ្រើស **renumber-order** ក្នុង Bulk import ជំនួស។

**បញ្ចូល Ep បន្តរាល់ថ្ងៃ៖** ទុក `run-watch.bat` បើកចោល → Ep ថ្មីចូល group →
វាទាញ + upload → `links_<prefix>.txt` ត្រូវបាន update ភ្លាម → paste តែបន្ទាត់ថ្មី
ចូល Bulk import (ជ្រើស keep — Admin panel រំលង Ep ដែលមានស្រាប់ដោយខ្លួនឯង)។

---

## ល្បឿន — របៀបធ្វើឱ្យលឿនជាងមុន

Telegram កំណត់ល្បឿនលើ **connection នីមួយៗ** មិនមែនលើគណនីទេ។ ដូច្នេះ tool នេះ៖

1. **បើក connection ច្រើនក្នុងពេលតែមួយសម្រាប់ video តែមួយ** — video ១ ត្រូវបានកាត់
   ជាចម្រៀកៗ ហើយ connection នីមួយៗទាញចម្រៀករបស់ខ្លួនស្របគ្នា រួចផ្គុំជា file
   តែមួយវិញ (`TG_CONNECTIONS`)។ នេះជាចំណុចដែលលឿនជាងគេ — ធម្មតា **៣–៦ដង**។
2. **ទាញ និង upload ស្របគ្នា** — ពេល video ទី១ កំពុង upload នោះ video ទី២
   កំពុងទាញរួចហើយ (`TG_WORKERS`, `TG_UPLOADERS`)។
3. **`cryptg`** — បើគ្មាន វា decrypt ដោយ Python សុទ្ធ ដែលយឺតជាងច្រើន។
   Tool នឹងព្រមានថា `[SLOW] cryptg is missing` បើមិនទាន់ដំឡើង។
4. **ប្រើ Topic បើមាន** — `TG_TOPIC` ធ្វើឱ្យ Telegram ជ្រើសឱ្យតែម្ដង ជំនួសឱ្យ
   ការដើរមើលសារទាំង group។ ក្នុង group ធំ នេះកាត់ពេល scan បានច្រើនដង។
5. **មិន scan ដដែលៗ** — Group ដែលមានសាររាប់ពាន់ ចំណាយពេលច្រើនត្រឹមតែ scan។
   Tool ចាំទីតាំងចុងក្រោយដែល scan រួច ដូច្នេះលើកក្រោយវាមើលតែសារថ្មីៗប៉ុណ្ណោះ
   (ឃើញ `resuming after message #...`)។ ចង់ scan ពីដើមវិញ ដាក់ `RESCAN_ALL=1`។
   *(បើប្តូរ `FILTER` វា scan ពីដើមឡើងវិញដោយស្វ័យប្រវត្តិ — មិនខកខានរឿងចាស់ទេ)*

### Setting ល្បឿន (ក្នុង `run-download.bat`)

| ជួរ | អត្ថន័យ | ណែនាំ |
|---|---|---|
| `TG_CONNECTIONS` | ចំនួន connection ចែកគ្នាទាញ video ១ | `4` (internet លឿន/VPS ដាក់ `8`) |
| `TG_WORKERS` | ចំនួន video ទាញព្រមគ្នា | `2`–`3` |
| `TG_UPLOADERS` | ចំនួន video upload ព្រមគ្នា | `2`–`3` |
| `PARALLEL_MIN_MB` | file តូចជាងនេះ មិនបាច់ចែក connection | `8` |
| `UPLOAD_CHUNK_MB` / `UPLOAD_CONCURRENCY` | ទំហំ + ចំនួន part ពេល upload | `16` / `8` |

**របៀបជ្រើសលេខត្រឹមត្រូវ៖** double-click **`run-bench.bat`** — វានឹងទាញ video
ពិតមួយ ២ដង (១ connection និង `TG_CONNECTIONS` connection) រួចប្រាប់ថាលឿនប៉ុន្មានដង។
បើនៅតែឡើងខ្ពស់ សាកបង្កើន `TG_CONNECTIONS` ម្ដងមួយជំហាន។ លើសពី `8` ជាធម្មតា
Telegram នឹងឱ្យរង់ចាំ (FloodWait) ជំនួសឱ្យការលឿនជាងមុន។

> បើឃើញ `[WAIT] Telegram asked for ...s` ញឹកញាប់ — បន្ថយ `TG_CONNECTIONS` ឬ
> `TG_WORKERS` មកវិញ។ វារង់ចាំដោយខ្លួនឯង មិនបាត់ file ទេ។

> ល្បឿនអតិបរមានៅតែអាស្រ័យលើ internet របស់អ្នក។ បើ line ផ្ទះយឺត ដាក់លើ **VPS**
> (Singapore ជិតបំផុត) នឹងលឿនជាងច្រើន — មើល `tools/VPS_SETUP_KH.md` ដែលមានរួច
> សម្រាប់ ABA relay វិធីដូចគ្នា គ្រាន់តែប្តូរ script ជា `tg_video_to_s3.py`
> ហើយប្រើ `run-download.sh.template`។

### Option បន្ថែម

| ជួរ | អត្ថន័យ |
|---|---|
| `DRY_RUN=1` | គ្រាន់តែបង្ហាញថានឹងទាញអ្វីខ្លះ **មិនទាញ មិន upload** — សាកលើកដំបូងជានិច្ច |
| `MAX_ITEMS=3` | ឈប់បន្ទាប់ពី ៣ file (សម្រាប់សាកល្បង) |
| `MIN_MB=20` | រំលង file តូចជាង 20MB (រំលង clip/sticker) |
| `KEEP_LOCAL=1` | រក្សា file ក្នុង `_tmp` ផង បន្ទាប់ពី upload |
| `NEWEST_FIRST=1` | ចាប់ពី video ថ្មីបំផុតទៅចាស់ (default: ចាស់ → ថ្មី) |
| `RESCAN_ALL=1` | scan សារទាំងអស់ពីដើមឡើងវិញ (មិនប្រើទីតាំងចាស់) |
| `EP_KEYS=0` | កុំដាក់ `ep-<n>/` ក្នុង key (ត្រឡប់ទៅឈ្មោះចាស់ `<id>_<file>`) |
| `PICK_LIMIT=300` | ចំនួនជួរអតិបរមាដែល `run-pick.bat` បង្ហាញ |

---

## ដំណើរការយ៉ាងណា

- វាចាំថា file ណាធ្វើរួចហើយ (ក្នុង folder `_state`) — **ដំណើរការឡើងវិញបានគ្រប់ពេល
  ដោយមិនទាញយកស្ទួន**។ បិទចោលពាក់កណ្ដាលក៏បាន គ្រាន់តែបើកវាឡើងវិញ។
- បើ file នៅលើ S3 រួចហើយ (ទំហំដូចគ្នា) វារំលង។
- ឈ្មោះ file៖ `<prefix><message_id>_<ឈ្មោះដើម>` ឧ. `anime/000123_EP01.mp4`
- file បណ្ដោះអាសន្នស្ថិតក្នុង `_tmp` ហើយត្រូវលុបភ្លាមបន្ទាប់ពី upload។
- **`uploaded_urls.csv`** ត្រូវបានសរសេរបន្ថែមរាល់ file ដែលរួចរាល់ (key + URL)។
- **`links_<prefix>.txt`** = URL សុទ្ធ ១ បន្ទាត់ ១ link តម្រៀបតាមលេខភាគ —
  file នេះហើយដែលត្រូវ copy ទៅ paste ក្នុង **Bulk import** របស់ Admin panel។

## តេស្តថា code ដំណើរការត្រឹមត្រូវ (មិនបាច់ login)

```
python tg_video_to_s3.py selftest
```
វាតេស្តការកាត់ចម្រៀក, ការផ្គុំ file ឡើងវិញ, ការ retry ពេល connection ដាច់, និង
state file — ទាំងអស់ដោយមិនប៉ះ Telegram។ ត្រូវឃើញ `all checks passed`។

## បញ្ហាដែលអាចជួប

| សារ | មូលហេតុ / ដំណោះស្រាយ |
|---|---|
| `does not use Topics` | Group នេះគ្មាន topic — ប្រើ `run-shows.bat` ជំនួស |
| ឈ្មោះរឿងចេញជា `□□□□` | Windows console គូរអក្សរខ្មែរមិនបាន — បើក `topics.txt` / `shows.txt` ដោយ Notepad |
| `cannot open chat ...` | គណនីអ្នកមិនទាន់ចូល group នោះ ឬ id ខុស — ប្រើ id ដែល `list-chats.bat` បោះពុម្ព |
| `[SLOW] cryptg is missing` | រត់ `python -m pip install cryptg` — លឿនជាងមុនច្រើន |
| `[WAIT] Telegram asked to wait ...` | ធម្មតា — បន្ថយ `TG_CONNECTIONS`/`TG_WORKERS` បើញឹកញាប់ពេក |
| `parallel download failed ... retrying the slow way` | វាដូរទៅ ១ connection ដោយខ្លួនឯង — file នៅតែបានគ្រប់ |
| `extra connection N failed` | Telegram មិនឱ្យបើក connection ច្រើនម្ដងនេះ — វានៅតែដំណើរការ |
| `NoSuchBucket` / `AccessDenied` | ខុស bucket/endpoint ឬ token គ្មានសិទ្ធិ Write |
| `InvalidArgument` លើ R2 | R2 មិនទទួល `S3_STORAGE_CLASS` — ទុកវាទទេ |
| `SignatureDoesNotMatch` | key ខុស ឬ endpoint ខុស provider |
| `telethon is not installed` | រត់ `install-windows.bat` ជាមុន |

## សុវត្ថិភាព

- `tg_downloader.session` = login Telegram ពេញលេញ, `config.json` ផ្ទុក api_hash,
  និង `run-download.bat` ផ្ទុក AWS key — **កុំ upload ទៅ GitHub**។
  (`.gitignore` របស់ project នេះបានការពាររួចហើយ — មានតែ `.template` ប៉ុណ្ណោះដែលចូល git។)

## ចំណាំផ្នែកច្បាប់

ទាញយកតែ content ដែលអ្នកមានសិទ្ធិប្រើ (ផ្ទាល់ខ្លួន ឬមានអាជ្ញាបណ្ណ) ដើម្បីជៀសវាង
បញ្ហារក្សាសិទ្ធិ ពេលយកទៅចាក់ក្នុង app។
