/**
 * Referral identities — one comparable form for a doctor's name.
 *
 * A referral register is free text typed at a counter, and it ages like fruit:
 * `DR MANOJ KUMAR`, `DR.MANOJ KUMAR`, `Dr. Manoj Kumar (MBBS)` are one person to
 * the lab and three people to a `Map` keyed on the string. Because patients store
 * `doctorName` rather than a doctor id, every grouping in the app inherits the
 * problem: the Top Referring Doctors chart splits one doctor across three bars,
 * the referral sheet under-counts their patients, and the dropdown shows the same
 * name four times so the next registration picks whichever spelling was clicked.
 *
 * These helpers do not rewrite stored data — they only decide how records are
 * *compared and grouped*, so a lab's own capitalisation stays on the page while
 * matching becomes stable.
 */

/** A record carrying a doctor's name, in whatever shape the caller has it. */
export interface NamedRecord {
  name: string;
}

/**
 * Canonical key for comparing two referrals.
 *
 * Deliberately aggressive on punctuation and case (title dots, bracketed
 * qualifications, `{EYE}` suffixes, apostrophes) and deliberately conservative
 * on two things:
 *
 *  - word order: two names match only when they carry the same words in the same
 *    order, because "KUMAR SINGH DR" versus "DR SINGH KUMAR" is a different
 *    person often enough that sorting the words would create merges nobody asked
 *    for.
 *  - qualifications: `DR MANOJ KUMAR` and `DR MANOJ KUMAR MBBS` stay distinct.
 *    Stripping degree tokens would fold them together, and two practitioners can
 *    share a name in this register — merging two doctors' histories is a worse
 *    error than showing one doctor's referrals under two spellings.
 */
export function doctorNameKey(name: string | undefined): string {
  return String(name ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[.,'/]/g, ' ')
    .replace(/\bDOCTOR\b/g, 'DR')
    .replace(/\bPROF\b/g, 'PROF')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display form for a name the app has to render without a stored spelling.
 *
 * Used only where the register is being created (an autocomplete choice that is
 * not already on file); existing records keep exactly what the lab typed.
 */
export function normaliseDoctorName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  // An all-caps record from an older register stays all caps: switching it to
  // title case would make the same doctor read differently across screens.
  const shouty = trimmed === trimmed.toUpperCase();
  return shouty ? trimmed.toUpperCase() : trimmed.replace(/\b\w/g, letter => letter.toUpperCase());
}

export interface DoctorGroup<T> {
  /** The spelling shown for the group. */
  name: string;
  /** The key every member folded into. */
  key: string;
  members: T[];
}

/**
 * Group records that refer to the same doctor.
 *
 * The displayed name is the spelling recorded most often — the register's own
 * habit, not an algorithm's invention — with the shortest variant winning a tie
 * so a bare `DR X KUMAR` beats `DR X KUMAR MBBS MD` when both appear twice.
 */
export function groupByDoctorName<T>(
  records: readonly T[],
  nameOf: (record: T) => string | undefined,
): DoctorGroup<T>[] {
  const groups = new Map<string, { counts: Map<string, number>; members: T[] }>();

  for (const record of records) {
    const name = String(nameOf(record) ?? '').trim();
    if (!name) continue;
    const key = doctorNameKey(name);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { counts: new Map(), members: [] };
      groups.set(key, group);
    }
    group.members.push(record);
    group.counts.set(name, (group.counts.get(name) ?? 0) + 1);
  }

  return [...groups.entries()].map(([key, group]) => {
    let name = '';
    let best = -1;
    for (const [candidate, count] of group.counts) {
      if (count > best || (count === best && candidate.length < name.length)) {
        name = candidate;
        best = count;
      }
    }
    return { name, key, members: group.members };
  });
}

/**
 * De-duplicate a name list, keeping the first spelling seen.
 *
 * Used where the app merges its seeded suggestions with the lab's own register:
 * without folding on the key, `DR ARVIND KUMAR` and `DR. ARVIND KUMAR` both stay
 * in the dropdown and the patient ends up attached to whichever one was tapped.
 */
export function dedupeDoctorNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = doctorNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Whether a typed query is asking for this doctor.
 *
 * Every word typed has to appear in the canonical name, in any position: the
 * register writes `DR SHAILENDRA KUMAR MS` and the bench types "shailendra ms".
 */
export function doctorMatchesQuery(name: string | undefined, query: string): boolean {
  const haystack = doctorNameKey(name);
  const terms = doctorNameKey(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every(term => haystack.includes(term));
}
