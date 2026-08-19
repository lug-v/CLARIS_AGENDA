const GROQ_URL = "https://api.groq.com/openai/v1";

export type CalendarEventDraft = {
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  confidence: number;
  sourceText: string;
};

const systemPrompt = `Você transforma pedidos em compromissos de calendário em português do Brasil. Responda APENAS um objeto JSON válido com exatamente: title, date, endDate, startTime, endTime, location, notes, confidence e sourceText.

Regras:
- date é a primeira data do compromisso em YYYY-MM-DD.
- endDate é a última data, inclusive, em YYYY-MM-DD. Em compromisso de um dia, endDate deve ser igual a date.
- Resolva expressões relativas usando a data atual informada e o fuso America/Sao_Paulo.
- Considere a semana brasileira de domingo a sábado. "Semana que vem" é a semana imediatamente posterior à atual.
- Em intervalos como "de domingo a sexta-feira", preserve todos os dias entre as duas datas.
- Se um compromisso de vários dias não informar horário, use startTime 00:00 e endTime 23:59.
- Se um compromisso de um dia não informar horário, use startTime 09:00 e endTime 10:00.
- location contém apenas o local explicitamente informado. Não invente local.
- notes pode explicar o período ou informações adicionais sem repetir título, data e local.
- confidence deve ser um número de 0 a 1. Reduza apenas quando houver ambiguidade real.
- sourceText deve repetir o pedido recebido.`;

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function relativeWeekRange(sourceText: string, today: string) {
  const normalized = sourceText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const weekday = "(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)";
  const match = normalized.match(new RegExp(`(?:de\\s+)?${weekday}\\s+(?:a|ate)\\s+${weekday}(?:\\s+da)?\\s+(?:semana\\s+que\\s+vem|proxima\\s+semana)`));
  if (!match) return null;

  const weekdayNumber = (value: string) => {
    const name = value.split("-")[0];
    return ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"].indexOf(name);
  };
  const startWeekday = weekdayNumber(match[1]);
  const endWeekday = weekdayNumber(match[2]);
  if (startWeekday < 0 || endWeekday < 0) return null;

  const nextSunday = dateFromKey(today);
  nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()));
  const start = new Date(nextSunday);
  start.setDate(start.getDate() + startWeekday);
  const end = new Date(nextSunday);
  end.setDate(end.getDate() + endWeekday + (endWeekday < startWeekday ? 7 : 0));
  return { date: localDateKey(start), endDate: localDateKey(end) };
}

function weekdayInSaoPaulo() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
  }).format(new Date());
}

async function groq(path: string, init: RequestInit) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY_NOT_CONFIGURED");
  const response = await fetch(`${GROQ_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`GROQ_${response.status}:${await response.text()}`);
  return response.json();
}

function normalizeEvent(value: Record<string, unknown>, sourceText: string): CalendarEventDraft {
  const today = todayInSaoPaulo();
  const relativeRange = relativeWeekRange(sourceText, today);
  const date = relativeRange?.date || String(value.date || today);
  const endDate = relativeRange?.endDate || String(value.endDate || date);
  return {
    title: String(value.title || "Novo compromisso"),
    date,
    endDate: endDate < date ? date : endDate,
    startTime: String(value.startTime || "09:00"),
    endTime: String(value.endTime || "10:00"),
    location: String(value.location || ""),
    notes: String(value.notes || ""),
    confidence: Number(value.confidence ?? 0.5),
    sourceText,
  };
}

export async function interpretText(text: string): Promise<CalendarEventDraft> {
  const today = todayInSaoPaulo();
  const result = await groq("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      response_format: { type: "json_object" },
      reasoning_effort: "none",
      max_completion_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Hoje é ${today} (${weekdayInSaoPaulo()}). Verifique se cada data corresponde ao dia da semana mencionado. Pedido: ${text}` },
      ],
    }),
  });
  const parsed = JSON.parse(result.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  return normalizeEvent(parsed, text);
}

export async function transcribeAudio(file: File) {
  const form = new FormData();
  form.append("file", file, file.name || "audio.ogg");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  form.append("response_format", "json");
  const transcription = await groq("/audio/transcriptions", { method: "POST", body: form });
  return String(transcription.text || "").trim();
}

export async function interpretImage(image: string, sourceText = "Compromisso extraído de uma imagem") {
  const today = todayInSaoPaulo();
  const result = await groq("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      response_format: { type: "json_object" },
      reasoning_effort: "none",
      max_completion_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Hoje é ${today} (${weekdayInSaoPaulo()}). Leia esta agenda e extraia o compromisso mais claro.` },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });
  const parsed = JSON.parse(result.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  return normalizeEvent(parsed, sourceText);
}
