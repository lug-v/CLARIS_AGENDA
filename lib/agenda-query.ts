export type AgendaRange = { start: string; end: string; label: string };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function detectAgendaQuery(text: string, today = todayInSaoPaulo()): AgendaRange | null {
  const value = normalize(text);
  const explicitCommand = value.startsWith("/agenda");
  const queryLanguage = /(o que (?:eu )?tenho|quais (?:sao )?(?:os |meus )?compromissos|tenho algo|mostre (?:a )?(?:minha )?agenda|minha agenda|meus compromissos|ver agenda)/.test(value);
  if (!explicitCommand && !queryLanguage) return null;

  const base = dateFromKey(today);
  if (/semana que vem|proxima semana/.test(value)) {
    const nextSunday = addDays(base, 7 - base.getDay());
    return { start: dateKey(nextSunday), end: dateKey(addDays(nextSunday, 6)), label: "da próxima semana" };
  }
  if (/esta semana|essa semana|semana atual/.test(value)) {
    const sunday = addDays(base, -base.getDay());
    return { start: dateKey(sunday), end: dateKey(addDays(sunday, 6)), label: "desta semana" };
  }
  if (/proximos 7 dias|proximas? sete dias/.test(value)) {
    return { start: today, end: dateKey(addDays(base, 6)), label: "dos próximos 7 dias" };
  }
  if (/amanha/.test(value)) {
    const tomorrow = dateKey(addDays(base, 1));
    return { start: tomorrow, end: tomorrow, label: "de amanhã" };
  }
  return { start: today, end: today, label: "de hoje" };
}
