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
  /** How many seasons of this franchise the catalog currently carries. */
  siblings: number;
}

/**
 * Every show that belongs to a franchise worth showing as a series with
 * seasons, ordered so the seasons of one franchise sit next to each
 * other and run 1, 2, 3.
 *
 * A franchise qualifies when it has more than one season in the catalog,
 * OR when its single entry is explicitly numbered (a lone "រដូវកាលទី ៥"
 * still tells the viewer they are looking at a long-running series, even
 * while the earlier seasons are missing). A one-off with no marker is
 * not a franchise and is left out.
 */
export function seasonalShows(shows: Show[]): SeasonEntry[] {
  const groups = new Map<string, { show: Show; season: number | null }[]>();
  for (const show of shows) {
    const { base, season } = parseSeason(show.title);
    const list = groups.get(base);
    if (list) list.push({ show, season });
    else groups.set(base, [{ show, season }]);
  }

  const out: SeasonEntry[] = [];
  for (const entries of groups.values()) {
    const numbered = entries.some((e) => e.season !== null);
    if (entries.length < 2 && !numbered) continue;
    const sorted = [...entries].sort((a, b) => (a.season ?? 1) - (b.season ?? 1));
    for (const e of sorted) {
      out.push({ show: e.show, season: e.season ?? 1, siblings: entries.length });
    }
  }

  // Franchises the viewer can actually binge in order come first: more
  // seasons available beats a lone high-numbered season.
  return out.sort((a, b) => {
    if (b.siblings !== a.siblings) return b.siblings - a.siblings;
    const base = parseSeason(a.show.title).base.localeCompare(parseSeason(b.show.title).base);
    return base !== 0 ? base : a.season - b.season;
  });
}
