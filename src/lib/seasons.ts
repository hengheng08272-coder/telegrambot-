import type { Show } from '@/lib/types';

/**
 * Season numbers live inside the title text, not in a column.
 *
 * The catalog spells them five different ways, all present in the live
 * data at the time of writing:
 *
 *   "ប្រហារព្រះ រដូវកាលទី១"                no space, Khmer numeral
 *   "ប្រហារព្រះ រដូវកាលទី ២"               space, Khmer numeral
 *   "លោកប្តីអស្ចារ្យ រដូវកាលទី1"            no space, ASCII numeral
 *   "ប្រយុទ្ធទៅកាន់មេឃា រដូវកាលទី 5"        space, ASCII numeral
 *   "ទឹកដីថាមពលវិញ្ញណ វគ្គ ២"              "វគ្គ" instead of "រដូវកាលទី"
 *
 * A title with no marker is season 1 of its own franchise — that is how
 * "ដំណើរឆ្ពោះទៅរកកម្រិតអទិទេព" and "… រដូវកាលទី ៣" end up recognised as two
 * seasons of one show.
 */

const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩';

function toArabic(text: string): number {
  let out = '';
  for (const ch of text) {
    const kh = KHMER_DIGITS.indexOf(ch);
    out += kh >= 0 ? String(kh) : ch;
  }
  return parseInt(out, 10);
}

const SEASON_RE = /\s*(?:រដូវកាលទី|វគ្គ)\s*([០-៩0-9]+)\s*$/;

export interface SeasonInfo {
  /** Title with the season marker stripped — the franchise key. */
  base: string;
  /** Season number, or null when the title carries no marker at all. */
  season: number | null;
}

export function parseSeason(title: string): SeasonInfo {
  // \u200B rather than the literal character: the zero-width space is
  // invisible in an editor, so writing it inline makes the regex look
  // like it matches nothing.
  const clean = title.replace(/\u200B/g, '').trim();
  const match = SEASON_RE.exec(clean);
  if (!match) return { base: clean, season: null };
  return { base: clean.slice(0, match.index).trim(), season: toArabic(match[1]) };
}

export interface SeasonEntry {
  show: Show;
  season: number;
}

export interface SeasonFranchise {
  /** Franchise name, with the season marker stripped off. */
  base: string;
  /** Its seasons, in order. Always two or more — see below. */
  entries: SeasonEntry[];
}

/**
 * Shows grouped into franchises that actually have more than one season
 * in the catalog, each franchise ordered 1, 2, 3.
 *
 * Two or more is the whole bar. A lone "រដូវកាលទី ៥" with no earlier
 * seasons present has nothing to pick between, so a row of its own would
 * be a row with one card in it; those titles stay in the ordinary rows.
 * Franchises with the most seasons come first.
 */
export function seasonFranchises(shows: Show[]): SeasonFranchise[] {
  const groups = new Map<string, SeasonEntry[]>();
  for (const show of shows) {
    const { base, season } = parseSeason(show.title);
    const entry = { show, season: season ?? 1 };
    const list = groups.get(base);
    if (list) list.push(entry);
    else groups.set(base, [entry]);
  }

  const out: SeasonFranchise[] = [];
  for (const [base, entries] of groups) {
    if (entries.length < 2) continue;
    out.push({ base, entries: [...entries].sort((a, b) => a.season - b.season) });
  }

  return out.sort((a, b) =>
    b.entries.length - a.entries.length || a.base.localeCompare(b.base),
  );
}

/**
 * For a free show, the next season that is NOT free — the thing a viewer
 * finishing the free season is about to want.
 *
 * The free row is a hook, not a gift: two of the three shows opened up
 * are season 1 of a series whose season 2 stays behind the membership.
 * Saying so on the card turns "here is something free" into "watch this,
 * then join to keep going", which is the actual offer. Returns null when
 * there is nothing to continue to, so the hint only appears where it is
 * true.
 */
export function nextPaidSeason(show: Show, all: Show[]): Show | null {
  if (!show.is_free) return null;
  const { base, season } = parseSeason(show.title);
  const current = season ?? 1;

  let best: { show: Show; season: number } | null = null;
  for (const other of all) {
    if (other.id === show.id || other.is_free || other.coming_soon) continue;
    const info = parseSeason(other.title);
    if (info.base !== base) continue;
    const n = info.season ?? 1;
    if (n <= current) continue;
    if (!best || n < best.season) best = { show: other, season: n };
  }
  return best?.show ?? null;
}
