const GROQ_URL = "https://api.groq.com/openai/v1";

type CalendarEvent = {
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

async function groq(path: string, init: RequestInit) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY_NOT_CONFIGURED");
  const response = await fetch(`${GROQ_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`GROQ_${response.status}:${await response.text()}`);
  return response.json();
}

async function interpretText(text: string): Promise<CalendarEvent> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const result = await groq("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen/qwen3.6-27b", response_format: { type: "json_object" }, temperature: 0, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Hoje é ${today}. Pedido: ${text}` }] }),
  });
  const event = JSON.parse(result.choices?.[0]?.message?.content || "{}");
  return { title: event.title || "Novo compromisso", date: event.date || today, startTime: event.startTime || "09:00", endTime: event.endTime || "10:00", location: event.location || "", notes: event.notes || "", confidence: Number(event.confidence ?? 0.5), sourceText: text };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const input = await request.formData();
      const file = input.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Arquivo de áudio ausente." }, { status: 400 });
      const form = new FormData();
      form.append("file", file, file.name || "audio.webm");
      form.append("model", "whisper-large-v3-turbo");
      form.append("language", "pt");
      form.append("response_format", "json");
      const transcription = await groq("/audio/transcriptions", { method: "POST", body: form });
      return Response.json({ event: await interpretText(transcription.text), transcript: transcription.text });
    }

    const body = await request.json() as { type?: string; text?: string; image?: string };
    if (body.type === "image" && body.image) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const result = await groq("/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "qwen/qwen3.6-27b", response_format: { type: "json_object" }, temperature: 0, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: [{ type: "text", text: `Hoje é ${today}. Leia esta agenda e extraia o compromisso mais claro.` }, { type: "image_url", image_url: { url: body.image } }] }] }),
      });
      return Response.json({ event: JSON.parse(result.choices?.[0]?.message?.content || "{}") });
    }
    if (!body.text?.trim()) return Response.json({ error: "Descreva um compromisso." }, { status: 400 });
    return Response.json({ event: await interpretText(body.text.trim()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada";
    if (message === "GROQ_API_KEY_NOT_CONFIGURED") return Response.json({ error: "A chave da Groq ainda não foi configurada." }, { status: 503 });
    return Response.json({ error: "Não consegui interpretar este conteúdo. Tente novamente." }, { status: 500 });
  }
}
