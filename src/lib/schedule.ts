/**
 * Plain-language schedules. Agents store a 5-field cron; people pick
 * "Weekdays at 8:00". Anything that doesn't fit the simple shape is "custom".
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type SimpleSchedule = { freq: "daily" | "weekdays" | "weekly"; day: number; hour: number; minute: number };

export function parseCron(cron: string | null | undefined): SimpleSchedule | null {
  if (!cron) return null;
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, h, dom, mon, dow] = f as [string, string, string, string, string];
  if (!/^\d{1,2}$/.test(mi) || !/^\d{1,2}$/.test(h) || dom !== "*" || mon !== "*") return null;
  const minute = Number(mi);
  const hour = Number(h);
  if (minute > 59 || hour > 23) return null;
  if (dow === "*") return { freq: "daily", day: 1, hour, minute };
  if (dow === "1-5" || dow === "MON-FRI") return { freq: "weekdays", day: 1, hour, minute };
  if (/^[0-7]$/.test(dow)) return { freq: "weekly", day: Number(dow) % 7, hour, minute };
  return null;
}

export function toCron(s: SimpleSchedule) {
  const dow = s.freq === "daily" ? "*" : s.freq === "weekdays" ? "1-5" : String(s.day);
  return `${s.minute} ${s.hour} * * ${dow}`;
}

export const fmtTime = (hour: number, minute = 0) => `${hour}:${String(minute).padStart(2, "0")}`;

/** "Weekdays at 8:00", or null when the cron isn't one of the simple shapes. */
export function describeCron(cron: string | null | undefined): string | null {
  const s = parseCron(cron);
  if (!s) return null;
  const t = fmtTime(s.hour, s.minute);
  if (s.freq === "daily") return `Every day at ${t}`;
  if (s.freq === "weekdays") return `Weekdays at ${t}`;
  return `${DAY_NAMES[s.day]}s at ${t}`;
}

/** What to show for an agent's schedule anywhere in the UI. */
export function scheduleLabel(a: { enabled: boolean; schedule_cron: string | null; spec: { schedule: string } }) {
  if (!a.enabled) return "Paused";
  if (!a.schedule_cron) return "On demand";
  return describeCron(a.schedule_cron) ?? "Custom schedule";
}

/** Customer-facing name for a model id: never the raw id. */
export function modelTierLabel(model: string | null | undefined, deepId: string) {
  if (!model || model === "offline") return null;
  return model === deepId ? "Deep" : "Fast";
}
