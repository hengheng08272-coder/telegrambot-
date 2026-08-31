# KHQR Gateway — បង់រួច ដោះសោ VIP ស្វ័យប្រវត្តិ

## ១. ដាក់ Secrets (Supabase → Settings → Edge Functions → Secrets)

> ## ⚠️ មុននឹងដាក់ — ត្រូវដឹងថាលុយចូលគណនីណា
>
> **លុយចូលគណនីដែលចុះឈ្មោះជាមួយ `api_token` នៅលើ gateway** —
> មិនមែនតាមតម្លៃដែលកូដផ្ញើទៅទេ។ បើមិនដូច្នេះ អ្នកណាក៏អាចប្តូរ
> គណនីអ្នកដទៃបាន។
>
> ដូច្នេះ៖ **ចូល dashboard របស់ gateway ពិនិត្យថា token នេះជាប់នឹង
> គណនីធនាគាររបស់អ្នក** មុននឹងបើកប្រើ។ បើវាជាប់នឹងគណនីអ្នកផ្សេង
> លុយអតិថិជនទាំងអស់នឹងចូលគណនីអ្នកនោះ។
>
> សាកល្បង៖ ទិញ $0.10 មួយ រួចពិនិត្យថាលុយចូល**ធនាគាររបស់អ្នក**ឬអត់។

**ចាំបាច់**

```
KHQR_GATEWAY_TOKEN = <token របស់អ្នក ពី dashboard gateway>
```

**ស្រេចចិត្ត** (បើមិនដាក់ វានឹងប្រើតម្លៃ default របស់ gateway)

```
KHQR_GATEWAY_BASE           = https://mengsmm.store
KHQR_GATEWAY_ACCOUNT        = <Bakong account របស់អ្នក>
KHQR_GATEWAY_MERCHANT_NAME  = Nint_Anime
KHQR_GATEWAY_MERCHANT_CITY  = Phnom Penh
KHQR_GATEWAY_STORE_LABEL    = NINT ANIME
KHQR_GATEWAY_TERMINAL_LABEL = NINT VIP
```

> តម្លៃ ៥ ខាងលើគ្រាន់តែជា **ស្លាក** ដែល gateway *អាច* យកទៅដាក់ក្នុង QR
> ប៉ុណ្ណោះ — វា**មិនកំណត់ថាលុយចូលណាទេ**។ លុយចូលតាម token ដដែល។

> **Token មិនត្រូវដាក់ក្នុង `VITE_*` ជាដាច់ខាត។** `VITE_*` ត្រូវបាន bundle
> ចូល app — អ្នកណាក៏អាចអានបាន។ Token នេះស្ថិតនៅតែក្នុង edge function
> ប៉ុណ្ណោះ ហើយ browser មិនដែលឃើញវាទេ។

## ២. Run SQL

`database/khqr-gateway-addition.sql` (បន្ថែម column `khqr_md5`,
`khqr_bill_number`, `bakong_hash` + unique index)។ **Run រួចហើយ**។

## ៣. ដំណើរការយ៉ាងម៉េច

1. អ្នកមេីលចុចទិញ → បង្កើត ticket ក្នុង `payment_submissions`
2. App ហៅ `khqr-gateway` → `action: generate` → gateway បង្កើត QR
   **តាមតម្លៃរបស់ ticket** (មិនមែនតម្លៃដែល client ផ្ញើមកទេ)
3. QR បង្ហាញក្នុង app (គូរពី `qr_string`; បើមិនបាន ប្រើ `qr_image_url`)
4. រាល់ **៣ វិនាទី** app សួរ `action: check`
5. ឃើញ `SUCCESS` ឬ `PAID` → claim ticket → ផ្តល់ VIP → ផ្ញើសារទៅ admin
6. ឃើញ `EXPIRED` → បោះ QR ចាស់ចោល បង្កើតថ្មី
7. ឃើញ `PENDING` → រង់ចាំបន្ត

## ៤. អ្វីដែលការពារកុំឲ្យខុស

| ហានិភ័យ | ការការពារ |
| --- | --- |
| បង់ ១ ដង បាន ២ ខែ | claim មុន (`WHERE status='pending'`) — path ណាដែលឈ្នះទេីបផ្តល់ |
| យក bill ចាស់មកប្រើម្តងទៀត | unique index លើ `khqr_bill_number` |
| Gateway ផ្តល់ QR ចាស់មកវិញ | ពិនិត្យថា bill នោះជាប់នឹង ticket ផ្សេងឬអត់ → បដិសេធ + សារព្រមាន |
| បង់តិចជាងតម្លៃ | ប្រៀបធៀប amount ជាមួយ ticket (លំអៀង ≤ $0.009) |
| Client កុហកតម្លៃ | amount យកពី DB មិនយកពី request |
| Token ផុតកំណត់ | HTTP 401/403 → log ច្បាស់ `token-rejected` |

## ៥. សាកល្បង

```bash
curl -s -X POST 'https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/khqr-gateway' \
  -H 'Content-Type: application/json' \
  -d '{"action":"generate","submission_id":"<ticket-id>"}'
```

បើឃើញ `{"error":"KHQR_GATEWAY_TOKEN is not set","configured":false}` →
មិនទាន់ដាក់ secret។ បើឃើញ `qr_string` → ដំណើរការហើយ។

Log៖ Supabase → Edge Functions → khqr-gateway → Logs (រក `[GATEWAY]`)។
