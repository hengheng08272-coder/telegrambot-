# របៀបដំណើរការ Relay លើ Windows (មិនចាំបាច់ចេះ bash)

អ្នកកំពុងប្រើ **Windows** ដូច្នេះមិនចាំបាច់វាយពាក្យបញ្ជាវែងៗទេ —
ខ្ញុំបានធ្វើ **ឯកសារចុចពីរដង (.bat)** ឲ្យស្រាប់។

> **bash ជាអ្វី?** វាជា terminal របស់ Linux/Mac។ Windows គ្មានទេ (មាន
> Command Prompt / PowerShell ជំនួស)។ ដូច្នេះខ្ញុំបំប្លែងពាក្យបញ្ជាទាំងអស់
> ទៅជាឯកសារ `.bat` រួចហើយ — អ្នកគ្រាន់តែ **ចុចពីរដង**។

---

## ឯកសារដែលអ្នកមាន

| ឯកសារ | ធ្វើអ្វី |
|---|---|
| `install-windows.bat` | ដំឡើងកម្មវិធីចាំបាច់ (ធ្វើម្ដងគត់) |
| `run-relay.bat` | **ឯកសារដែលអ្នកត្រូវកែ** + ដំណើរការ relay |
| `list-chats.bat` | បង្ហាញបញ្ជី chat ទាំងអស់ + ID |
| `aba-userbot-forwarder.py` | កម្មវិធីពិត (មិនបាច់ប៉ះ) |
| `requirements.txt` | បញ្ជីកញ្ចប់ (មិនបាច់ប៉ះ) |

---

## ជំហានទី ១ — ដំឡើង Python

1. ចូល https://www.python.org/downloads/ → ចុច **Download Python**
2. បើកឯកសារដែល download មក
3. 🔴 **សំខាន់បំផុត**: នៅអេក្រង់ដំបូង **ធីក ☑ "Add python.exe to PATH"**
   មុននឹងចុច Install។ បើភ្លេច ត្រូវ uninstall រួចដំឡើងម្ដងទៀត។
4. ចុច **Install Now** → រង់ចាំ → **Restart កុំព្យូទ័រ**

---

## ជំហានទី ២ — ដាក់ឯកសារក្នុងថតមួយ

បង្កើតថតឧទាហរណ៍ `C:\aba-relay` រួចដាក់ឯកសារទាំង ៥ ខាងលើចូលក្នុងនោះ។

---

## ជំហានទី ៣ — ចុចពីរដងលើ `install-windows.bat`

វានឹងបើកផ្ទាំងខ្មៅ ហើយដំឡើងកម្មវិធីចាំបាច់។ រង់ចាំរហូតឃើញ **Done**។

បើវាប្រាប់ថា `Python not found` → ត្រឡប់ទៅជំហានទី ១ (ភ្លេចធីក PATH)។

---

## ជំហានទី ៤ — កែ `run-relay.bat`

**ចុចខាងស្ដាំ** លើ `run-relay.bat` → **Show more options** → **Edit**
(ឬបើកដោយ Notepad)។

រកបន្ទាត់ ៤ នេះ រួចជំនួស `REPLACE_ME`៖

```
set TG_API_ID=12345678
set TG_API_HASH=abcdef0123456789abcdef0123456789
set ABA_INGEST_SECRET=<secret ដែលអ្នកដាក់ក្នុង Supabase>
set ABA_SOURCE_CHATS=-5588646530
```

⚠️ **ច្បាប់សរសេរ**៖
- **គ្មានសញ្ញា " "** (quotes)
- **គ្មានដកឃ្លា** មុន ឬក្រោយសញ្ញា `=`
- ខុស៖ `set TG_API_ID = "12345678"`
- ត្រូវ៖ `set TG_API_ID=12345678`

រួច **Ctrl+S** រក្សាទុក។

---

## ជំហានទី ៥ — ចុចពីរដងលើ `list-chats.bat`

**លើកដំបូងតែម្ដង** វានឹងសួរ៖

```
Please enter your phone (or bot token): +85512345678
Please enter the code you received: 12345
```

- លេខទូរស័ព្ទ៖ ត្រូវមាន `+855` ពីមុខ
- កូដ៖ មកក្នុង **app Telegram** (មិនមែន SMS)
- បើមាន 2FA វាសួរ password ដែរ

បន្ទាប់មកវាបោះពុម្ព៖

```
              ID  TYPE       NAME
     -5588646530  group      ABA_NOTIFIER
      1148497258  user       userinfobot
```

👉 រកជួរ **ABA_NOTIFIER** — បើលេខខុសពី `-5588646530` សូមកែក្នុង
`run-relay.bat` ឲ្យត្រូវ។

---

## ជំហានទី ៦ — ចុចពីរដងលើ `run-relay.bat`

ផ្ទាំងខ្មៅនឹងបង្ហាញ៖

```
Starting relay. Keep this window OPEN
Watching: [-5588646530]
Filter:   S2_Nint.Ani
```

🔴 **កុំបិទផ្ទាំងនេះ** — បិទ = ការទូទាត់ឈប់បញ្ជាក់ស្វ័យប្រវត្តិ។

### សាកល្បង

1. Admin Panel → Subscriptions → ប្ដូរតម្លៃ `១ ខែ` ជា `0.01` → Save
2. បើក app → ចុច **"ចូលសមាជិក VIP"**
3. បង់ $0.01 តាម QR
4. មើលផ្ទាំងខ្មៅ — គួរឃើញ៖

```
[SEEN] chat=-5588646530 text='$0.01 paid by ...'
[RELAY] 200 {"ok":true,"matched":true,...}
```

5. 🔴 **ប្ដូរតម្លៃត្រឡប់ទៅ `2` វិញភ្លាម**

---

## ⚠️ បញ្ហាធំរបស់ការរត់លើ Windows

កុំព្យូទ័រ **sleep ឬបិទ = ការទូទាត់ឈប់ដំណើរការ** ហើយអតិថិជនដែលបង់លុយរួច
នឹងជាប់គាំង។ ដូច្នេះ៖

**យ៉ាងហោចណាស់ត្រូវបិទ Sleep៖**
Settings → System → Power & battery → Screen and sleep →
កំណត់ **Sleep = Never** (ទាំង battery និង plugged in)

**ដំណោះស្រាយល្អជាង៖** ទិញ VPS ថោក (~$4/ខែ) ឲ្យវារត់ ២៤ម៉ោង។
បើចង់ ខ្ញុំអាចណែនាំជំហានតម្លើងលើ VPS បាន។

**កុំភ្លេច**៖ Upload វិក្កយបត្រនៅតែដំណើរការជា fallback ក្នុង app
ដូច្នេះទោះ relay ដាច់ អតិថិជនមិនបាត់លុយទេ — គ្រាន់តែត្រូវរង់ចាំ admin។

---

## បើចង់វាយពាក្យបញ្ជាដោយខ្លួនឯង (មិនចាំបាច់)

បើក **PowerShell** (ចុច Start វាយ "PowerShell")៖

```powershell
cd C:\aba-relay
$env:TG_API_ID="12345678"
$env:TG_API_HASH="abcdef..."
$env:ABA_INGEST_SECRET="..."
$env:ABA_SOURCE_CHATS="-5588646530"
python aba-userbot-forwarder.py list
```

ចំណាំ៖ PowerShell ប្រើ `$env:NAME="value"` — **មិនមែន** `export NAME=value`
ដូច bash លើ Linux/Mac ទេ។
