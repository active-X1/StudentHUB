// Calendar-day arithmetic in an IANA time zone (used for the admin lockout reset: "until the next calendar day").
// DST-safe: resolves the UTC instant of local midnight by checking the zone's offset at that instant.
function parts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second };
}
function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
function localMidnightInstant(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0); // Date.UTC normalises day overflow (e.g. day 32)
  let t = guess - offsetMs(new Date(guess), timeZone);
  t = guess - offsetMs(new Date(t), timeZone); // re-check: the offset may differ at the resolved instant (DST)
  return new Date(t);
}
export function startOfLocalDay(now, timeZone) { const p = parts(now, timeZone); return localMidnightInstant(p.year, p.month, p.day, timeZone); }
export function nextLocalMidnight(now, timeZone) { const p = parts(now, timeZone); return localMidnightInstant(p.year, p.month, p.day + 1, timeZone); }
