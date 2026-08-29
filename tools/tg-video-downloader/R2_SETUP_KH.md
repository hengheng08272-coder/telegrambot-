# រៀបចំ Cloudflare R2 សម្រាប់ផ្ទុក Video

R2 ជាកន្លែងផ្ទុក file របស់ Cloudflare។ ហេតុអ្វីជ្រើសវាសម្រាប់ video៖
**egress (bandwidth) ឥតគិតថ្លៃ គ្មានកំណត់** — មិនថាមានអ្នកមើលប៉ុន្មាននាក់ក៏ដោយ
អ្នកបង់តែថ្លៃ **ផ្ទុក** ប៉ុណ្ណោះ (១០GB ដំបូងឥតគិតថ្លៃ)។

> ប្រៀបធៀប៖ Vercel Hobby ឱ្យត្រឹម 100GB/ខែ — EP មួយ 587MB មើលបាន ~១៧០ដង
> ក៏អស់។ R2 គ្មានកំណត់នេះទេ។

---

## ជំហាន ១ — បង្កើតគណនី និងបើក R2

1. ចូល https://dash.cloudflare.com → **Sign up** (ឥតគិតថ្លៃ)
2. ម៉ឺនុយឆ្វេង → **R2 Object Storage**
3. ចុច **Purchase R2** / **Enable R2**

> ⚠️ Cloudflare នឹងសុំ **កាតទូទាត់** ទោះជាប្រើ free tier ក៏ដោយ។ វា**មិនកាត់លុយ**
> ទេ ដរាបណាអ្នកនៅក្រោម ១០GB។ បើមិនចង់ដាក់កាត — សូមប្រើ Bunny.net ជំនួស
> (បង់មុន ~$1 ក៏បាន)។

---

## ជំហាន ២ — បង្កើត Bucket

1. R2 → **Create bucket**
2. **Bucket name**: `nintplex-videos` (អក្សរតូច, គ្មានចន្លោះ)
3. **Location**: ជ្រើស **Asia-Pacific (APAC)** — ជិតកម្ពុជាបំផុត
4. **Create bucket**

---

## ជំហាន ៣ — បើកឱ្យមើលបានជាសាធារណៈ

Video ត្រូវតែបើកបានពី browser ទើប Mini App ចាក់បាន។ មាន ២ ជម្រើស៖

### ក. `r2.dev` — លឿន សម្រាប់សាកល្បង

Bucket → **Settings** → **Public Development URL** → **Enable**

អ្នកនឹងបាន URL បែប៖
```
https://pub-xxxxxxxxxxxxxxxx.r2.dev
```

> ⚠️ Cloudflare កំណត់ល្បឿន (rate limit) លើ `r2.dev` ហើយ**មិនណែនាំសម្រាប់
> ប្រើពិត**។ ល្អសម្រាប់សាកតែប៉ុណ្ណោះ។

### ខ. Custom domain — ណែនាំសម្រាប់ប្រើពិត ⭐

ត្រូវការ domain ដែលគ្រប់គ្រងដោយ Cloudflare (ឧ. `nintanime.com`)។

1. Bucket → **Settings** → **Custom Domains** → **Connect Domain**
2. បញ្ចូល៖ `cdn.nintanime.com`
3. Cloudflare បង្កើត DNS record ឱ្យស្វ័យប្រវត្តិ → រង់ចាំ ១–២ នាទី

បានផលចំណេញ៖ CDN cache ពេញលេញ, គ្មាន rate limit, URL ស្អាត។

---

## ជំហាន ៤ — យក API Token

1. R2 → **Manage R2 API Tokens** (ជ្រុងខាងស្តាំ) → **Create API token**
2. **Token name**: `telegram-downloader`
3. **Permissions**: **Object Read & Write**
4. **Specify bucket**: ជ្រើសតែ bucket `nintplex-videos` (សុវត្ថិភាពជាង)
5. **Create API Token**

វានឹងបង្ហាញ ៣ តម្លៃ — **ចម្លងទុកភ្លាម វាបង្ហាញតែម្តងគត់**៖

| តម្លៃ | ប្រើសម្រាប់ |
|---|---|
| **Access Key ID** | `AWS_ACCESS_KEY_ID` |
| **Secret Access Key** | `AWS_SECRET_ACCESS_KEY` |
| **Account ID** (ឃើញនៅទំព័រ R2) | បង្កើត endpoint |

> 🔒 តម្លៃទាំងនេះ = សិទ្ធិសរសេរចូល bucket អ្នក។ **កុំផ្ញើឱ្យអ្នកណា កុំដាក់
> ចូល GitHub** — ដាក់តែក្នុង `run-download.bat` ដែលត្រូវបាន gitignore រួចហើយ។

---

## ជំហាន ៥ — បំពេញ `run-download.bat`

បើកដោយ Notepad រួចកែផ្នែក storage៖

```bat
REM --- storage ---
set SAVE_DIR=./downloads

set AWS_ACCESS_KEY_ID=<Access Key ID ពីជំហាន ៤>
set AWS_SECRET_ACCESS_KEY=<Secret Access Key ពីជំហាន ៤>
set S3_BUCKET=nintplex-videos
set S3_PREFIX=anime/martial-god-asura/

set S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
set AWS_REGION=auto
set S3_ADDRESSING=

REM URL សាធារណៈពីជំហាន ៣ (ត្រូវមាន / នៅចុង)
set PUBLIC_BASE_URL=https://cdn.nintanime.com/
```

**ចំណាំសំខាន់៖**

| ជួរ | ត្រូវដាក់ |
|---|---|
| `S3_ENDPOINT` | `https://` + Account ID + `.r2.cloudflarestorage.com` |
| `AWS_REGION` | ត្រូវតែ `auto` សម្រាប់ R2 |
| `S3_STORAGE_CLASS` | **ទុកទទេ** — R2 មិនទទួល storage class របស់ AWS |
| `PUBLIC_BASE_URL` | URL ពីជំហាន ៣ **ត្រូវមាន `/` នៅចុង** |

---

## ជំហាន ៦ — សាកមុន (កុំរំលង)

ក្នុង `run-download.bat` ដាក់បណ្ដោះអាសន្ន៖
```bat
set DRY_RUN=0
set MAX_ITEMS=1
```
រួច double-click `run-download.bat` — វានឹង upload តែ **១ file** ប៉ុណ្ណោះ។

រកមើលបន្ទាត់នេះនៅចុងបញ្ចប់៖
```
#862 done -> https://cdn.nintanime.com/anime/martial-god-asura/ep-1/....mp4
```

**ចម្លង URL នោះទៅបើកក្នុង browser** — បើ video ចាក់បាន និងរំកិល (seek) បាន
នោះជាការត្រឹមត្រូវ ✅

រួចដូរ `MAX_ITEMS=0` ត្រឡប់មកវិញ ដើម្បីទាញទាំងអស់។

---

## ជំហាន ៧ — បញ្ចូលចូល Mini App

បន្ទាប់ពីទាញរួច បើក **`links_anime_martial_god_asura.txt`** →
**Ctrl+A, Ctrl+C** → Admin panel → បើករឿងនោះ → **Bulk import** → **Ctrl+V** →
ជ្រើស **keep** → **Add**

---

## បញ្ហាដែលអាចជួប

| សារ | មូលហេតុ / ដំណោះស្រាយ |
|---|---|
| `SignatureDoesNotMatch` | key ខុស ឬ `S3_ENDPOINT` ខុស Account ID |
| `NoSuchBucket` | ឈ្មោះ bucket ខុស ឬ endpoint ខុសគណនី |
| `AccessDenied` | Token គ្មានសិទ្ធិ **Object Read & Write** ឬ scope ខុស bucket |
| `InvalidArgument` | `S3_STORAGE_CLASS` មិនទទេ — R2 មិនទទួល |
| URL បើកបាន 401/404 | មិនទាន់បើក Public URL ឬ Custom Domain (ជំហាន ៣) |
| Video download ជំនួសឱ្យចាក់ | R2 កំណត់ `Content-Type` ខុស — tool ដាក់ `video/mp4` ឱ្យរួចហើយ បើនៅតែខុស ពិនិត្យ file នៅ R2 dashboard |

---

## ថ្លៃប្រហែល

| | បរិមាណ | ថ្លៃ |
|---|---|---|
| ផ្ទុក | ១០GB ដំបូង | **$0** |
| ផ្ទុក | បន្ទាប់ពីនោះ | ~$0.015/GB/ខែ |
| **Bandwidth (អ្នកមើល)** | គ្មានកំណត់ | **$0** 🎯 |
| Upload operations | ១ លាន/ខែ ដំបូង | $0 |

ឧទាហរណ៍ពិត៖ ៧ EP × 587MB ≈ **4GB** → នៅក្នុង free tier → **$0/ខែ**
បើដាក់ ១០០ EP (~57GB) → ប្រហែល **$0.7/ខែ** ប៉ុណ្ណោះ។

*(តម្លៃអាចប្រែប្រួល — ផ្ទៀងផ្ទាត់នៅ https://developers.cloudflare.com/r2/pricing/)*

---

## បន្ថែម (សម្រាប់ថ្ងៃក្រោយ)

### CORS — ត្រូវការតែពេលប្រើ HLS

Player របស់ project នេះ support HLS (`.m3u8`) ស្រាប់។ បើថ្ងៃក្រោយអ្នកប្តូរទៅ
HLS នោះ browser ត្រូវការ CORS។ Bucket → **Settings** → **CORS Policy**៖

```json
[
  {
    "AllowedOrigins": ["https://nintplex-one.vercel.app"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["range"],
    "ExposeHeaders": ["content-length", "content-range", "accept-ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

MP4 ធម្មតា (`<video src>`) **មិនត្រូវការ CORS ទេ**។

### បន្ថយទំហំ file

587MB/EP ធ្ងន់សម្រាប់ទូរស័ព្ទ។ បម្លែងជា 720p នឹងនៅ ~200MB៖
```
ffmpeg -i in.mp4 -vf scale=-2:720 -c:v libx264 -crf 23 -c:a aac -b:a 128k -movflags +faststart out.mp4
```
`-movflags +faststart` ធ្វើឱ្យ video ចាប់ចាក់ភ្លាមដោយមិនរង់ចាំ download ទាំងមូល។
