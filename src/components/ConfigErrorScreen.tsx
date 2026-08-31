import { AlertTriangle } from 'lucide-react';

interface Props {
  missing: string[];
}

// Shown instead of the app when a build went out without its Supabase
// keys. Every screen here reads from Supabase, so there is nothing to
// degrade to — the point is that the admin opening the Mini App sees
// WHICH variable is missing rather than a blank screen, since the fix is
// a one-line dashboard change plus a rebuild.
export default function ConfigErrorScreen({ missing }: Props) {
  return (
    <div className="min-h-screen bg-[#0A101E] text-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h1 className="text-lg font-bold mb-2">កម្មវិធីមិនទាន់បានកំណត់រចនាសម្ព័ន្ធ</h1>
        <p className="text-sm text-white/70 leading-relaxed mb-4">
          ការតភ្ជាប់ទៅ database មិនគ្រប់គ្រាន់ ដូច្នេះកម្មវិធីមិនអាចដំណើរការបានទេ។
        </p>

        <div className="rounded-xl bg-black/40 p-3 mb-4 text-left">
          <p className="text-[11px] uppercase tracking-wide text-white/40 mb-2">
            អថេរដែលខ្វះ
          </p>
          <ul className="space-y-1">
            {missing.map((name) => (
              <li key={name} className="font-mono text-xs text-amber-300 break-all">
                {name}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/50 leading-relaxed text-left">
          ដាក់វានៅ Vercel → Settings → Environment Variables (ជ្រើស <b>All
          Environments</b>) រួច <b>Redeploy</b> ម្ដងទៀត។ តម្លៃទាំងនេះត្រូវបាន
          បញ្ចូលក្នុង build ដូច្នេះការដាក់ប៉ុណ្ណោះមិនគ្រប់គ្រាន់ទេ — ត្រូវ build ជាថ្មី។
        </p>
      </div>
    </div>
  );
}
