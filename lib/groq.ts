const GROQ_URL = "https://api.groq.com/openai/v1";

export type CalendarEventDraft = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  confidence: number;
  sourceText: string;
};

const systemPrompt = `Você transforma pedidos em compromissos de calendário. Responda APENAS JSON válido com: title, date (YYYY-MM-DD), startTime (HH:mm), endTime (HH:mm), location, notes, confidence (0 a 1), sourceText. Considere o fuso America/Sao_Paulo e a data atual informada. Se não houver duração, use 1 hora. Não invente local. Se data ou horário estiverem incertos, reduza confidence.`;

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
  return {
    title: String(value.title || "Novo compromisso"),
    date: String(value.date || today),
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
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Hoje é ${today}. Pedido: ${text}` },
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
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Hoje é ${today}. Leia esta agenda e extraia o compromisso mais claro.` },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });
  const parsed = JSON.parse(result.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  return normalizeEvent(parsed, sourceText);
}
