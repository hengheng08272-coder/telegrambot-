# ប្រព័ន្ធទូទាត់ពិត — ABA PayWay Gateway API (ស្វ័យប្រវត្តិ ១០០%)

នេះជាការដាក់ដំណើរការ **ABA PayWay Payment Gateway ពិតប្រាកដ** (Create Transaction +
Check Transaction APIs) — ខុសពី QR ថេរ ឬ merchant link ថេរ។ ពេលបានដាក់រួច ប៊ូតុង
"ចុចទូទាត់ភ្លាមៗ" នឹង៖
1. បង្កើត transaction ថ្មីមួយពិតប្រាកដជាមួយ ABA (មិនមែន link/QR ថេរទេ)
2. បើក app ABA ដោយផ្ទាល់ (deeplink) ដើម្បីទូទាត់
3. ABA ខ្លួនឯង **ផ្ញើសារត្រឡប់មកម្ចាស់គេហទំព័រ (callback)** ពេលទូទាត់ចប់
4. ប្រព័ន្ធ **ត្រួតពិនិត្យម្ដងទៀតផ្ទាល់ជាមួយ ABA** (Check Transaction API) មុននឹងផ្ដល់ VIP
   — មិនជឿសារ callback ភ្លាមៗឡើយ សុវត្ថិភាពជាង

ការមួយនេះជំនួស (មិនលុប) ប្រព័ន្ធចាស់ (`aba-payment-webhook` ដែលទាយពីសារ Telegram
forward + `auto-approve-payment` ១៨០វិនាទី) — ២ ប្រព័ន្ធនេះនៅតែដំណើរការជា fallback
ប្រសិនបើ gateway មិនទាន់ setup ឬ payment មិនមែនតាម gateway។

---

## អ្វីដែលត្រូវការពី ABA

ត្រូវទាក់ទង **ABA PayWay Integration Team** (មិនមែន app ធម្មតាទេ — ត្រូវជា merchant
account ដែលបើក API access) សុំ៖

1. **Sandbox account** សាកល្បងមុន — ABA នឹងផ្ញើ `merchant_id` + `API key` សម្រាប់ sandbox
2. **Production `merchant_id` + `API key`** (ពេលត្រៀមរួច)
3. សុំ ABA whitelist domain គេហទំព័ររបស់អ្នក + URL callback ខាងក្រោម៖
   ```
   https://<PROJECT-REF>.supabase.co/functions/v1/aba-payment-callback
   ```
   (`<PROJECT-REF>` គឺជាផ្នែកដំបូងនៃ Supabase URL របស់អ្នក — មើលក្នុង Supabase Dashboard)

## ជំហានទី១ — Deploy edge functions ថ្មី

⚠️ **កំណត់សម្គាល់ (2026-08)** — ឯកសារនេះធ្លាប់សរសេរថាមាន function ២ ស្រាប់។ តាមពិត
មានតែ **១** ប៉ុណ្ណោះ៖

| Function | ស្ថានភាព |
|---|---|
| `aba-payment-callback` | ✅ មានស្រាប់ក្នុង `supabase/functions/` |
| `aba-create-transaction` | ❌ **មិនមានទេ** — មិនដែលសរសេរ |

Code ខាង client (`createAbaCheckout` ក្នុង `src/lib/subscription.ts`) ហៅ
`aba-create-transaction` មែន ប៉ុន្តែដោយសារ function នោះមិនមាន វាត្រឡប់
`configured: false` ជានិច្ច ហើយ app ធ្លាក់ទៅ QR ធម្មតាដោយស្ងាត់ៗ។ នេះជាមូលហេតុដែល
"ចុចទូទាត់ភ្លាមៗ" មិនដែលដំណើរការ។

ដូច្នេះមុននឹងធ្វើតាមជំហានខាងក្រោម **ត្រូវសរសេរ `aba-create-transaction` ជាមុនសិន**។
វាគួរប្រើ endpoint `POST /api/payment-gateway/v1/payments/generate-qr`
(payment_option = `abapay_khqr`) ដែលឆ្លើយត្រឡប់ជា KHQR + deeplink ក្រោមឈ្មោះ merchant
ចុះឈ្មោះរបស់អ្នក — ហើយ ABA ទទួលស្គាល់ ១០០% ព្រោះខ្លួនវាបង្កើតដោយខ្លួនឯង។

លំដាប់វាលក្នុង `hash` ត្រូវយកពី Developer Suite ដោយផ្ទាល់
(`developer.payway.com.kh` → QR API → ប៉ារ៉ាម៉ែត្រ `hash`) — កុំទាយជាដាច់ខាត បើខុស
មួយវាល ABA ឆ្លើយ "invalid hash"។

Deploy ដូចធម្មតា (Supabase CLI ឬ Dashboard).

## ជំហានទី២ — Run SQL migration

Run `database/aba-gateway-addition.sql` ក្នុង SQL Editor (បន្ថែម column តាមដាន
`aba_tran_id` លើតារាង `payment_submissions` ដែលមានស្រាប់)។

## ជំហានទី៣ — Set Secrets (Supabase Dashboard → Edge Functions → Secrets)

```
ABA_PAYWAY_MERCHANT_ID = merchant_id ដែល ABA ផ្ដល់ (sandbox ឬ production)
ABA_PAYWAY_API_KEY     = API key ដែល ABA ផ្ដល់ — សំខាន់ណាស់កុំចែក/leak
ABA_PAYWAY_ENV         = sandbox  (ប្ដូរជា production ពេលត្រៀមរួច)
```

ដរាបណា ២ secrets ដំបូង (`ABA_PAYWAY_MERCHANT_ID`, `ABA_PAYWAY_API_KEY`) មិនទាន់ set —
app នឹង**ធ្លាក់ត្រឡប់ទៅ QR/link ថេរដដែល** ដោយស្វ័យប្រវត្តិ គ្មានអ្វីខូចទេ។

## ជំហានទី៤ — សាកល្បង Sandbox ជាមុនសិន (សំខាន់ណាស់!!)

1. Set secrets ខាងលើជា **sandbox** merchant_id/API key (`ABA_PAYWAY_ENV=sandbox`)
2. បើក app → Subscribe → ជ្រើសរើសជម្រើសណាមួយ → ចុច "ចុចទូទាត់ភ្លាមៗ — បញ្ជាក់ស្វ័យប្រវត្តិ"
3. ត្រូវទៅ ABA sandbox checkout ចេញ — ប្រើ **sandbox test card/account** ដែល ABA ផ្ដល់
   (កុំប្រើលុយពិត)
4. បញ្ចប់ការទូទាត់ sandbox → ត្រួតពិនិត្យ Supabase Edge Function logs នៃ
   `aba-payment-callback` ថាឃើញ `payment_status: APPROVED` និង VIP ត្រូវបានផ្ដល់
5. លុះត្រាតែជំហាននេះដំណើរការត្រឹមត្រូវទាំងស្រុង **ទើបប្ដូរ** `ABA_PAYWAY_ENV=production`
   និងដាក់ merchant_id/API key ពិត

## កំហុសទូទៅដែលត្រូវជៀសវាង

- ❌ ដាក់ production credentials ដោយមិនសាកល្បង sandbox មុន
- ❌ មិនសុំ ABA whitelist callback URL — ABA នឹងមិនផ្ញើ callback មកទេ បើ URL មិនស្ថិតក្នុង
  whitelist
- ❌ គិតថា gateway នេះជំនួស QR/manual flow ទាំងស្រុង — ការពិត វានៅតែមាន fallback
  (QR ថេរ + admin manual approve) សម្រាប់ករណី gateway មិនដំណើរការ ឬអ្នកទស្សនាចង់ scan
  ដោយខ្លួនឯង
- ❌ កែ order នៃ field ក្នុង hash generation (`aba-create-transaction` /
  `aba-payment-callback`) — លំដាប់ត្រូវតែដូច ABA documentation បេះបិទ បើកែខុស hash នឹង
  ខុសហើយ ABA response នឹង "Wrong hash"
