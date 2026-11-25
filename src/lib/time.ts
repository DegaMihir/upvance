/** Time-zone helpers (no dependencies). */
function parts(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

export function safeTz(tz: string | null | undefined) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC" });
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

/** Local date (YYYY-MM-DD) and hour in a time zone. */
export function localNow(tz: string, now = new Date()) {
  const p = parts(safeTz(tz), now);
  return { date: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, hour: p.h, minute: p.mi };
}

/** UTC instant of local midnight today in `tz`. */
export function startOfLocalDay(tz: string, now = new Date()) {
  const p = parts(safeTz(tz), now);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.y, p.m - 1, p.d) - offset);
}
