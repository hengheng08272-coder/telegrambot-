# អ្វីដែលបានកែ / What changed

Copy these 3 files back into your project (same paths) and redeploy:

- `src/lib/khqr.ts`
- `src/components/SubscriptionsPanel.tsx`
- `src/components/SubscriptionModal.tsx`

## 1. ហេតុអ្វី Open ABA មិនដំណើរការ (root cause)

ខ្ញុំបានភ្ជាប់ចូល Supabase project `Miniapp` (dowjxhkijtlsdvhyuddt) ដោយផ្ទាល់ ហើយពិនិត្យតារាង
`payment_qr_codes` — ទាំង `khqr_string` និង `pay_link` គឺ **NULL សម្រាប់គ្រប់ tier ទាំង 4**។
នោះមានន័យថា ប៊ូតុង "Open ABA" គ្មានអ្វីទៅបើកទេ (កូដទាមទារយ៉ាងហោចណាស់មួយក្នុងចំណោមពីរនេះ)។
មូលហេតុ៖ ការអាន QR ស្វ័យប្រវត្តិ (`decodeKhqrFromFile`) បរាជ័យពេល upload គ្រប់ tier ទាំង4—
ប្រហែលមកពីរូបភាព KHQR ដែល export ចេញពី ABA មាន logo កណ្តាល ឬទំហំធំពេក ធ្វើឲ្យ jsQR អានពុំចេញ។

**កំណែសម្រួល**: `khqr.ts` ឥឡូវព្យាយាមអានច្រើនដង — ទំហំដើម បូកនឹងទំហំបង្រួញ (900px, 600px, 1400px)
និងទាំង normal + inverted colors — ដើម្បីបង្កើនឱកាសអានចេញ។

**អ្វីដែលអ្នកត្រូវធ្វើបន្ទាប់**: បើក Admin → Subscriptions ថ្មី រួច "Replace" រូប QR ម្តងទៀត
សម្រាប់ tier នីមួយៗ (ជាមួយកូដថ្មីនេះ ការអានគួរជោគជ័យច្រើនជាងមុន)។ បើនៅតែបរាជ័យ ប្រើប៊ូតុង
"បិទភ្ជាប់ដោយដៃ" ថ្មីក្នុងផ្ទាំង admin — ចម្លង KHQR text ពី ABA Business app (មិនមែនរូបភាព)
មកបិទភ្ជាប់ផ្ទាល់។ វិធីនេះធានាថាដំណើរការ 100% ដោយមិនអាស្រ័យលើការអានរូបភាពទាល់តែសោះ។

## 2. Admin panel — full-screen redesign

`SubscriptionsPanel.tsx`: ប្តូរពី popup តូច (max-w-lg) ទៅជាផ្ទាំង full-screen ដែលមាន grid
2-columns លើអេក្រង់ធំ ដូច្នេះគ្រប់ field (តម្លៃ, ខែ, ស្លាក, KHQR status) មើលឃើញភ្លាមៗ
មិនចាំបាច់ scroll ក្នុង scrollbox ក្នុង modal ថែមទៀតទេ។

បន្ថែម badge បង្ហាញស្ថានភាព KHQR ក្នុងផ្ទាំងនីមួយៗ (បៃតង = ត្រៀមរួច, លឿង = មិនទាន់មាន)
ដើម្បីកុំឲ្យបញ្ហានេះកកកុញនៅស្ងាត់ៗដូចលើកនេះទៀត។

## 3. QR ខែ (months) — ត្រួតពិនិត្យរួច

ទិន្នន័យក្នុង DB ត្រឹមត្រូវស្រាប់ (tier 2m = $5, 3 ខែ, label "៣ ខែ" ត្រូវគ្នា) — លេខ ៣ ដែលមើលទៅ
ដូចអក្សរ "ណ" ក្នុងរូបថត គ្រាន់តែជាបញ្ហា font ខ្នាតតូចប៉ុណ្ណោះ។ ខ្ញុំបានពង្រឹង logic ព្រមានការមិនត្រូវគ្នា
(mismatch warning) ឲ្យត្រួតពិនិត្យទាំង label ខ្មែរ និង English ដើម្បីចាប់កំហុសបានប្រសើរជាងមុន
ពេលក្រោយប្តូរតម្លៃ/ខែ។

## 4. ប៊ូតុង "Open ABA" — រូបរាងថ្មី

ប្តូរពីប៊ូតុង full-width ពណ៌ខៀវចាស់ (gradient pill ពេញទទឹង) មកជាប៊ូតុងតូច កណ្តាលទំព័រ
ជ្រុងមូលបន្តិច (មិនមូលពេញ) ផ្ទៃពណ៌ស្រាល (ស) អក្សរពណ៌ខៀវ ABA — តូចជាងមុន ស្អាតជាងមុន
ស្របតាមអ្វីដែលបានស្នើ។
