interface Props {
  groupLink?: string;
}

// Shown when verify-membership confirms the person opening the Mini App
// is not actually in the VIP group — most commonly someone who received
// a shared link/deep-link from a member but never joined themselves.
export default function NotMemberScreen({ groupLink }: Props) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app px-6 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF2D46]/10">
        <span className="text-3xl">🔒</span>
      </div>
      <p className="text-lg font-bold">ខ្លឹមសារនេះសម្រាប់តែសមាជិក VIP</p>
      <p className="max-w-xs text-sm text-white/50">
        គណនី Telegram របស់អ្នកមិនទាន់ជាសមាជិកនៃ group VIP ទេ។ សូមចូលរួម group ជាមុនសិន
        ទើបអាចមើលបាន។
      </p>
      {groupLink && (
        <a
          href={groupLink}
          className="rounded-full bg-gradient-to-r from-[#FF2D46] to-[#8F1020] px-6 py-2.5 text-sm font-bold text-white transition active:scale-95"
        >
          ចូលរួម VIP Group
        </a>
      )}
    </div>
  );
}
