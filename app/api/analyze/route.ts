import { interpretImageEvents, interpretText, transcribeAudio } from "@/lib/groq";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const input = await request.formData();
      const file = input.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Arquivo de áudio ausente." }, { status: 400 });
      const transcript = await transcribeAudio(file);
      const event = await interpretText(transcript);
      return Response.json({ event, events: [event], transcript });
    }

    const body = await request.json() as { type?: string; text?: string; image?: string };
    if (body.type === "image" && body.image) {
      const events = await interpretImageEvents(body.image);
      return Response.json({ event: events[0], events });
    }
    if (!body.text?.trim()) return Response.json({ error: "Descreva um compromisso." }, { status: 400 });
    const event = await interpretText(body.text.trim());
    return Response.json({ event, events: [event] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada";
    if (message === "GROQ_API_KEY_NOT_CONFIGURED") {
      return Response.json({ error: "A chave da Groq ainda não foi configurada." }, { status: 503 });
    }
    return Response.json({ error: "Não consegui interpretar este conteúdo. Tente novamente." }, { status: 500 });
  }
}
