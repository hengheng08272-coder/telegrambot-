# Theme v27 — "Obsidian" dark redesign + fullscreen player

ការរចនាថ្មី៖ ពណ៌ / ស្ទាយល៍ / ផ្ទៃខាងក្រោយ (dark mode) និង video player
សម្រាប់មើលពេញអេក្រង់។

## 1. Design tokens

`theme.ts` (TypeScript) និង `--nv-*` custom properties នៅក្នុង `src/index.css`
គឺជាប្រភពតែមួយសម្រាប់ពណ៌ទាំងអស់។ `tailwind.config.js` បន្ថែមឈ្មោះ semantic
(`bg-surface`, `text-muted`, `border-hairline`, `bg-brand-gradient`…)។

| Role | Old | New |
| --- | --- | --- |
| Page base | `#0A0A0D` | `#07080C` (`--nv-bg`) |
| Deep base (sheets, letterbox) | `#07070C` | `#04050A` |
| Surface / raised | `#0F1116` / `#151822` | `#0E1017` / `#151926` |
| Border | `#1B1F2A` | `#232838` |
| Primary (CTA, play, active tab) | `#E6231F` | `#FF2D46` |
| Primary light / dark | `#F0453A` / `#7A0F0D` | `#FF6B7C` / `#8F1020` |
| Secondary (trending, live) | `#2B5CAD` blue | `#4C6FFF` electric indigo |
| Accent (VIP only) | `#E3B341` | `#F5C563` |
| Success | `#34B37A` | `#2FD98C` |

Recolouring was applied across every screen, so the whole app moved together —
no screen was left on the old palette.

## 2. Background & surfaces

- `.bg-app` — the app background is no longer a flat fill: base colour plus three
  soft aurora pools (scarlet top-left, indigo top-right, gold bottom), fixed to
  the viewport so content scrolls over a still backdrop. Every full-screen root
  uses it; `.bg-app-deep` is the darker variant for sheets that sit on top.
- `.bar-blur` — translucent blurred bars (headers, bottom nav) with a solid
  fallback where `backdrop-filter` is unsupported.
- `.glass`, `.card-surface`, `.gold-frame`, `.btn-primary`, `.text-gradient-*`
  — shared surface/CTA treatments so new UI doesn't re-invent them.
- Bottom nav is now a floating dock (rounded, inset, glass) with a tinted pill
  on the active tab; top nav links became pills with a glowing underline.
- Cards: larger radius, brand-tinted hover ring, pill badges, gradient play button.
- All of the above live in `@layer components`, so Tailwind utilities
  (`hidden`, `text-*`, …) always win over them.
- `prefers-reduced-motion` stops every decorative loop.

## 3. Video player — fullscreen watching

`VideoPlayerScreen.tsx` now treats fullscreen as three mechanisms applied
together, because no single one works everywhere:

1. **Telegram Mini-App fullscreen** (Bot API 8.0+) — requested on open, the only
   way out from under Telegram's own header.
2. **Browser Fullscreen API** on the player container, with the `webkit`
   fallback and, for iOS Safari, `video.webkitEnterFullscreen()`.
3. **Landscape orientation lock**, so a phone held upright still fills the
   screen with picture.

Behaviour:

- The viewer's **first touch** on the player enters fullscreen (browsers only
  grant it inside a user gesture). Rotating to landscape tries once more. If the
  viewer leaves fullscreen deliberately, they are never pulled back in.
- Explicit fullscreen toggle button; back press exits fullscreen first, then
  leaves the screen; unmount always restores Telegram, the browser and the
  orientation lock.

New controls: playback speed menu (0.5×–2×), fit ↔ fill (crop) toggle, screen
lock (hides all controls and tap zones so a resting thumb can't seek), buffered
range behind the played range, drag-to-scrub with a growing track and knob,
desktop volume slider, and keyboard shortcuts (space/k, ←/→, ↑/↓, m, f, l).
Kept: double-tap ±10s, resume position, auto-advance, in-player episode sheet.

## 4. Screen polish (follow-up)

The screens that the first pass only recoloured now use the shared design
language too:

- **Account** — sticky frosted header with a round back button, `card-surface`
  blocks, `gold-frame` ring on the identity card while VIP is active, shared
  `btn-primary` CTA, settings list as one card.
- **Show detail** — glass back pill (safe-area aware), `rounded-card` poster and
  episode rows, gold glow on VIP-locked episodes, pill CTAs (`btn-primary` +
  glass secondary), shimmer skeletons.
- **Watchlist** — `card-surface` continue-watching rows, poster tiles matching
  the home rails (lift + brand ring on hover), `card-surface` empty states.
- **Subscription modal** — `bg-app-deep` sheet, `bar-blur` sticky footer,
  `rounded-card` plan cards, shared primary CTA.
- Remaining one-off primary buttons (lucky draw, not-member, announcements)
  now use `.btn-primary` instead of re-declaring the gradient.

## 5. Feedback pass (on-device)

Changes made after seeing the app running on a phone:

- **No photo background.** The full-page key-art layer, the fixed corner
  radials and the Top 10 rail's blurred still are gone. The page is flat
  black (`#050609`) and the only light on screen is the hero's own blurred
  poster, which now fades into pure black at both ends.
- **Scrolling.** Two things were making the page feel like it skidded: the
  background used `background-attachment: fixed` (repaints the viewport
  every frame) and the hero stored `scrollY` in React state, re-rendering a
  `blur-3xl` poster on every scroll event. The background is a flat colour
  now, and the hero parallax writes transform/opacity straight to the DOM
  node inside one `requestAnimationFrame`, with a gentler drift (0.18 vs
  0.35) so the backdrop never outruns the finger. Measured: a steady 16.7ms
  frame time while scrolling, no dropped frames.
- **Bottom tab bar** is welded to the bottom edge again (full width, flush
  with the home indicator) instead of a floating pill, and is opaque enough
  that posters no longer show through it.
- **Header** now turns from transparent to blurred once the page moves —
  before, it stayed transparent at every scroll position, so row titles and
  poster art slid under the logo and the VIP button.
- **Cards on phones**: the view-count badge moved from the top-right to the
  bottom-left (on a ~104px-wide card it collided with the VIP/FREE pill),
  Coming Soon moved to the right, badges are smaller below `sm:`, and the
  rails have more clearance above the tab bar.
