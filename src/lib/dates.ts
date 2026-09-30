import * as chrono from 'chrono-node';
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => isoDate(new Date());
export const addDays = (n: number, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export const parseDate = (s: string, ref = new Date()): string | null => {
  if (!s.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s))
    return Number.isNaN(new Date(s + 'T12:00:00').getTime()) ||
      isoDate(new Date(s + 'T12:00:00')) !== s
      ? null
      : s;
  const d = chrono.parseDate(s, ref, { forwardDate: true });
  return d ? isoDate(d) : null;
};
export const dateLabel = (s: string | null, short = false) => {
  if (!s) return '';
  if (s === today()) return 'Today';
  if (s === addDays(1)) return 'Tomorrow';
  if (s === addDays(-1)) return 'Yesterday';
  return new Date(s + 'T12:00:00').toLocaleDateString(
    'en-US',
    short
      ? { month: 'short', day: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric' },
  );
};
export function validRecurrence(rule: string): boolean {
  return /^(daily|monthly|every\s+(?:[1-9]\d*\s+)?(?:days?|weekdays?|weeks?|months?|monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/i.test(
    rule.trim(),
  );
}
export function nextOccurrence(rule: string, from: string): string {
  if (!validRecurrence(rule)) throw new Error('Unsupported repeat schedule');
  const d = new Date(from + 'T12:00:00');
  const r = rule.toLowerCase();
  const interval = Number(r.match(/\d+/)?.[0] || 1);
  if (r.includes('weekday')) {
    for (let n = 0; n < interval; n++) {
      do {
        d.setDate(d.getDate() + 1);
      } while ([0, 6].includes(d.getDay()));
    }
    return isoDate(d);
  }
  if (r.includes('month')) {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + Number(r.match(/\d+/)?.[0] || 1));
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return isoDate(d);
  }
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const day = weekdays.findIndex((w) => r.includes(w));
  if (day >= 0) return addDays(((day - d.getDay() + 7) % 7 || 7) + (interval - 1) * 7, d);
  return addDays(interval * (r.includes('week') ? 7 : 1), d);
}
export function parseQuickAdd(input: string, stacks: { id: string; name: string }[]) {
  let title = input;
  let stackId: string | null = null;
  const tags: string[] = [];
  title = title.replace(/([#@])([\w-]+)/g, (_, prefix: string, name: string) => {
    const stack =
      prefix === '#' ? stacks.find((s) => s.name.toLowerCase() === name.toLowerCase()) : null;
    if (stack) stackId = stack.id;
    else tags.push(name.toLowerCase());
    return '';
  });
  const candidate =
    title.match(
      /every\s+(?:\d+\s+)?(?:day|weekday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|monthly|daily/i,
    )?.[0] || null;
  const recurrence = candidate && validRecurrence(candidate) ? candidate : null;
  if (recurrence) title = title.replace(recurrence, '');
  const parsed = chrono.parse(title, new Date(), { forwardDate: true })[0];
  let scheduled: string | null = null,
    time: string | null = null;
  if (parsed) {
    scheduled = isoDate(parsed.start.date());
    if (parsed.start.isCertain('hour'))
      time = `${String(parsed.start.get('hour')).padStart(2, '0')}:${String(parsed.start.get('minute') || 0).padStart(2, '0')}`;
    title = title.replace(parsed.text, '');
  }
  if (recurrence && !scheduled)
    scheduled = /weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(recurrence)
      ? nextOccurrence(recurrence.replace(/\d+\s+/, ''), addDays(-1))
      : today();
  return { title: title.replace(/\s+/g, ' ').trim(), stackId, tags, scheduled, time, recurrence };
}
