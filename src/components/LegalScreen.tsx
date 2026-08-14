import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLang } from '@/lib/useLang';

interface Props {
  onBack: () => void;
}

// Plain-language, honest-about-what-we-actually-log legal copy — written
// to match what this specific app does (Telegram group as the access
// gate, VIP payment via screenshot verification, watch/ban logging for
// anti-leak moderation) rather than a generic boilerplate template.
export default function LegalScreen({ onBack }: Props) {
  const { lang } = useLang();
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const isKh = lang === 'km';

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-[#0A0A0D]/95 px-4 py-4 backdrop-blur-md sm:px-8">
        <button
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-bold">
          {isKh ? 'លក្ខខណ្ឌប្រើប្រាស់ & ឯកជនភាព' : 'Terms & Privacy'}
        </h1>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setTab('terms')}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
              tab === 'terms' ? 'bg-[#E6231F] text-white' : 'border border-white/10 bg-white/5 text-white/60'
            }`}
          >
            {isKh ? 'លក្ខខណ្ឌប្រើប្រាស់' : 'Terms of Service'}
          </button>
          <button
            onClick={() => setTab('privacy')}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
              tab === 'privacy' ? 'bg-[#E6231F] text-white' : 'border border-white/10 bg-white/5 text-white/60'
            }`}
          >
            {isKh ? 'គោលការណ៍ឯកជនភាព' : 'Privacy Policy'}
          </button>
        </div>

        {tab === 'terms' ? (
          isKh ? (
            <div className="space-y-4 text-sm leading-relaxed text-white/70">
              <p>
                NINT ANIME ជា Mini App ដែលដំណើរការក្នុង Telegram សម្រាប់សមាជិកនៃ group
                Telegram ជាក់លាក់ប៉ុណ្ណោះ។ សិទ្ធិចូលប្រើប្រាស់ខ្លឹមសារត្រូវបានគ្រប់គ្រងដោយ
                membership ក្នុង group នេះ — មិនមែនដោយ account ដាច់ដោយឡែកទេ។
              </p>
              <p>
                ខ្លឹមសារទាំងអស់ផ្តល់ជូនសម្រាប់គោលបំណងកម្សាន្តផ្ទាល់ខ្លួនប៉ុណ្ណោះ។ ការថត
                screenshot, screen recording, ចែកចាយ, ឬលក់បន្តខ្លឹមសារណាមួយចេញក្រៅ
                group ដោយគ្មានការអនុញ្ញាត ជាការរំលោភលើលក្ខខណ្ឌនេះ ហើយអាចនាំឲ្យសមាជិកភាព
                ត្រូវបានផ្អាក ឬដកចេញពី group ដោយគ្មានការជូនដំណឹងជាមុន។
              </p>
              <p>
                សេវាកម្ម VIP subscription ត្រូវបង់ប្រាក់តាមមធ្យោបាយដែលបានកំណត់ (ឧ. ABA/KHQR)
                ហើយត្រូវការផ្ទៀងផ្ទាត់ដោយ admin មុនដំណើរការសកម្ម។ ការទូទាត់មិនអាចដកមកវិញបានទេ
                លុះត្រាតែមានកំហុសបច្ចេកទេសពិតប្រាកដពីខាង app។
              </p>
              <p>
                យើងរក្សាសិទ្ធិកែប្រែលក្ខខណ្ឌទាំងនេះ គោលការណ៍តម្លៃ ឬខ្លឹមសារដែលមានស្រាប់
                គ្រប់ពេលដោយគ្មានការជូនដំណឹងជាមុន។
              </p>
            </div>
          ) : (
            <div className="space-y-4 text-sm leading-relaxed text-white/70">
              <p>
                NINT ANIME is a Telegram Mini App available only to members of a specific
                Telegram group. Access is controlled by group membership, not a separate
                account system.
              </p>
              <p>
                All content is provided for personal entertainment only. Screenshotting,
                screen recording, redistributing, or reselling any content outside the group
                without permission violates these terms and may result in suspension or
                removal from the group without prior notice.
              </p>
              <p>
                VIP subscriptions are paid through the designated method (e.g. ABA/KHQR) and
                require admin verification before activation. Payments are non-refundable
                except in cases of a genuine technical fault on the app's side.
              </p>
              <p>
                We reserve the right to change these terms, pricing, or available content at
                any time without prior notice.
              </p>
            </div>
          )
        ) : isKh ? (
          <div className="space-y-4 text-sm leading-relaxed text-white/70">
            <p>តើអ្វីខ្លះដែលយើងកត់ត្រា៖</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Telegram user ID និង username របស់អ្នក (ផ្តល់ដោយ Telegram ផ្ទាល់ ពេលបើក app)</li>
              <li>
                ប្រវត្តិការមើលវីដេអូ (រឿង, វគ្គ, ពេលវេលា) — សម្រាប់គោលបំណងសុវត្ថិភាព ការពារការ
                leak ខ្លឹមសារប៉ុណ្ណោះ
              </li>
              <li>ព័ត៌មានពាក់ព័ន្ធនឹង ban/kick ក្នុង group (ប្រសិនបើមាន)</li>
              <li>ព័ត៌មានពាក់ព័ន្ធនឹងការចាប់រង្វាន់ប្រចាំថ្ងៃ (spin) ប្រសិនបើប្រើមុខងារនេះ</li>
            </ul>
            <p>
              យើង<strong>មិន</strong>ចែកចាយព័ត៌មានទាំងនេះទៅភាគីទីបីណាមួយក្រៅពី admin ផ្ទាល់
              នៃ group នេះទេ។ ព័ត៌មានត្រូវបានផ្ទុកលើ Supabase (database provider) ដែលមាន
              ការការពារសមស្រប។ Admin ប៉ុណ្ណោះទើបចូលមើលទិន្នន័យទាំងនេះបាន។
            </p>
            <p>
              ការប្រើប្រាស់ app នេះបន្ត មានន័យថាអ្នកយល់ព្រមទទួលយកការប្រមូលទិន្នន័យខាងលើ។
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-sm leading-relaxed text-white/70">
            <p>What we collect:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your Telegram user ID and username (provided by Telegram itself when the app opens)</li>
              <li>
                Viewing history (show, episode, timestamp) — used only for anti-leak/security
                purposes
              </li>
              <li>Ban/kick events in the group, if any</li>
              <li>Daily lucky-draw participation, if you use that feature</li>
            </ul>
            <p>
              We do <strong>not</strong> share this information with any third party outside
              the group's own admin. Data is stored on Supabase (our database provider) with
              standard security protections. Only the admin can access this data.
            </p>
            <p>Continued use of this app means you accept the data collection described above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
