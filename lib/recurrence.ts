export type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";

export type RecurrenceRule = {
  recurrence: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: string;
  recurrenceCount: number;
};

export type RecurringEventInput = RecurrenceRule & {
  date: string;
  endDate: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function normalizeRecurrence(value: Partial<RecurrenceRule>, startDate: string): RecurrenceRule {
  const allowed: RecurrenceFrequency[] = ["none", "daily", "weekly", "monthly"];
  const recurrence = allowed.includes(value.recurrence as RecurrenceFrequency)
    ? value.recurrence as RecurrenceFrequency
    : "none";
  const recurrenceInterval = Math.min(12, Math.max(1, Math.trunc(Number(value.recurrenceInterval) || 1)));
  const recurrenceWeekdays = Array.from(new Set(
    (Array.isArray(value.recurrenceWeekdays) ? value.recurrenceWeekdays : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  )).sort();
  const recurrenceUntil = typeof value.recurrenceUntil === "string"
    && DATE_PATTERN.test(value.recurrenceUntil)
    && value.recurrenceUntil >= startDate
    ? value.recurrenceUntil
    : "";
  const recurrenceCount = recurrence === "none"
    ? 1
    : Math.min(52, Math.max(1, Math.trunc(Number(value.recurrenceCount) || 12)));
  return { recurrence, recurrenceInterval, recurrenceWeekdays, recurrenceUntil, recurrenceCount };
}

export function recurrenceLabel(rule: RecurrenceRule) {
  if (rule.recurrence === "none") return "";
  const names: Record<Exclude<RecurrenceFrequency, "none">, string> = {
    daily: "Diariamente",
    weekly: "Semanalmente",
    monthly: "Mensalmente",
  };
  const ending = rule.recurrenceUntil
    ? ` até ${rule.recurrenceUntil.split("-").reverse().join("/")}`
    : ` por ${rule.recurrenceCount} ocorrências`;
  return `${names[rule.recurrence]}${rule.recurrenceInterval > 1 ? ` (a cada ${rule.recurrenceInterval})` : ""}${ending}`;
}

export function expandRecurrence(input: RecurringEventInput) {
  const rule = normalizeRecurrence(input, input.date);
  const originalStart = dateFromKey(input.date);
  const originalEnd = dateFromKey(input.endDate || input.date);
  const durationDays = Math.max(0, Math.round((originalEnd.getTime() - originalStart.getTime()) / 86_400_000));
  if (rule.recurrence === "none") return [{ date: input.date, endDate: input.endDate || input.date, occurrenceIndex: 0 }];

  const starts: Date[] = [];
  const occurrenceLimit = rule.recurrenceUntil ? 52 : rule.recurrenceCount;
  const withinLimit = (date: Date) => !rule.recurrenceUntil || dateKey(date) <= rule.recurrenceUntil;
  if (rule.recurrence === "daily") {
    for (let index = 0; index < occurrenceLimit; index += 1) {
      const date = addDays(originalStart, index * rule.recurrenceInterval);
      if (!withinLimit(date)) break;
      starts.push(date);
    }
  } else if (rule.recurrence === "weekly") {
    const weekdays = rule.recurrenceWeekdays.length ? rule.recurrenceWeekdays : [originalStart.getDay()];
    for (let offset = 0; offset <= 730 && starts.length < occurrenceLimit; offset += 1) {
      const date = addDays(originalStart, offset);
      if (!withinLimit(date)) break;
      const weekIndex = Math.floor(offset / 7);
      if (weekIndex % rule.recurrenceInterval === 0 && weekdays.includes(date.getDay())) starts.push(date);
    }
  } else {
    const originalDay = originalStart.getDate();
    for (let index = 0; index < occurrenceLimit; index += 1) {
      const month = new Date(originalStart.getFullYear(), originalStart.getMonth() + index * rule.recurrenceInterval, 1, 12);
      const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12).getDate();
      month.setDate(Math.min(originalDay, lastDay));
      if (!withinLimit(month)) break;
      starts.push(month);
    }
  }
  return starts.map((start, occurrenceIndex) => ({
    date: dateKey(start),
    endDate: dateKey(addDays(start, durationDays)),
    occurrenceIndex,
  }));
}
