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

Project នេះមាន function ២ ក្នុង `supabase/functions/`៖

| Function | តួនាទី |
|---|---|
| `aba-create-transaction` | ហៅ PayWay **generate-qr** ពេលអ្នកទស្សនាចុច "ទូទាត់" → ទទួល KHQR + deeplink |
| `aba-payment-callback` | ទទួល callback ពី ABA + ផ្ទៀងផ្ទាត់ម្ដងទៀត (Check Transaction) + ផ្ដល់ VIP |

**ហេតុអ្វី generate-qr ជាដំណោះស្រាយត្រឹមត្រូវ**៖ KHQR ដែលយើងសាងសង់ខ្លួនឯង ABA បដិសេធ
ពេលបង់ (`Invalid Qr Merchant Data`) ព្រោះ QR របស់ ABA មាន tag 40 ផ្ទុកលេខយោងផ្ទាល់ខ្លួន
ដែលគ្មាននរណាក្រៅពី ABA ដឹង។ តែ QR ដែល **ABA ខ្លួនវាចេញឲ្យ** គ្មានបញ្ហានេះទេ ហើយវាមក
ក្រោម**ឈ្មោះ merchant ចុះឈ្មោះ**របស់អ្នក។

វាក៏លែងត្រូវការ Bakong token ពី NBC ដែរ — ការទូទាត់តាមផ្លូវនេះបញ្ជាក់ដោយ callback។

Deploy ដូចធម្មតា (Supabase CLI ឬ Dashboard).

## ជំហានទី២ — Run SQL migration

Run **២ ឯកសារ** ក្នុង SQL Editor តាមលំដាប់៖
1. `database/aba-gateway-addition.sql` — column `aba_tran_id`, `payment_method`
2. `database/aba-generate-qr-addition.sql` — column `aba_qr_string`, `aba_deeplink`
   + unique index លើ `aba_tran_id`

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


---

## ការរកមូលហេតុពេល ABA ឆ្លើយ "invalid hash"

នេះជាកំហុសតែមួយគត់ដែលមើលពីខាងក្រៅមិនដឹងមូលហេតុ។ `aba-create-transaction` ទទួល
`debug: true` ដែលត្រឡប់ **string ពិតដែលត្រូវបាន hash** មកវិញ (មិនរួម API key ទេ)៖

```bash
curl -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/aba-create-transaction" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ANON-KEY>" \
  -d '{"submission_id":"<ticket-uuid>","debug":true}'
```

យក `hashSource` នោះទៅប្រៀបធៀបនឹងឧទាហរណ៍ PHP ក្នុង Developer Suite។ លំដាប់វាល ១៩ គឺ៖

```
req_time · merchant_id · tran_id · amount · items · first_name · last_name ·
email · phone · purchase_type · payment_option · callback_url ·
return_deeplink · currency · custom_fields · return_params · payout ·
lifetime · qr_image_template
```

វាលដែល app មិនផ្ញើ (items, first_name, ...) **នៅតែរាប់បញ្ចូល** ជា string ទទេ។ បើទម្លាក់
ចោលមួយ អ្វីៗខាងក្រោយរអិល ហើយ hash លែងត្រូវ។
