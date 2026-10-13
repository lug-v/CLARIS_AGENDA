import { cookies } from "next/headers";
import { interpretImageEvents, interpretTextEvents, transcribeAudio } from "@/lib/groq";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { OWNER_COOKIE } from "@/lib/device";

export const runtime = "nodejs";

const HOURLY_LIMIT = Number(process.env.ANALYZE_HOURLY_LIMIT || 60);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Limita chamadas à IA por agenda para que a URL pública não consuma a chave do Groq sem controle.
async function consumeQuota(ownerId: string) {
  await ensureDatabaseSchema();
  const sql = getDatabase();
  const rows = await sql`
    INSERT INTO analyze_usage (owner_id, window_start, requests)
    VALUES (${ownerId}::uuid, date_trunc('hour', NOW()), 1)
    ON CONFLICT (owner_id, window_start) DO UPDATE SET requests = analyze_usage.requests + 1
    RETURNING requests
  `;
  return Number(rows[0]?.requests || 0) <= HOURLY_LIMIT;
}

export async function POST(request: Request) {
  const ownerId = (await cookies()).get(OWNER_COOKIE)?.value || "";
  if (!UUID_PATTERN.test(ownerId)) {
    return Response.json({ error: "Recarregue a página e tente novamente." }, { status: 401 });
  }
  try {
    if (!(await consumeQuota(ownerId))) {
      return Response.json({ error: "Limite de interpretações por hora atingido. Tente mais tarde." }, { status: 429 });
    }
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const input = await request.formData();
      const file = input.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Arquivo de áudio ausente." }, { status: 400 });
      const transcript = await transcribeAudio(file);
      const events = await interpretTextEvents(transcript);
      return Response.json({ event: events[0], events, transcript });
    }

    const body = await request.json() as { type?: string; text?: string; image?: string };
    if (body.type === "image" && body.image) {
      const events = await interpretImageEvents(body.image);
      return Response.json({ event: events[0], events });
    }
    if (!body.text?.trim()) return Response.json({ error: "Descreva um compromisso." }, { status: 400 });
    const events = await interpretTextEvents(body.text.trim().slice(0, 4000));
    return Response.json({ event: events[0], events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada";
    console.error("Erro ao interpretar compromisso:", error);
    if (message === "GROQ_API_KEY_NOT_CONFIGURED") {
      return Response.json({ error: "A chave da Groq ainda não foi configurada." }, { status: 503 });
    }
    return Response.json({ error: "Não consegui interpretar este conteúdo. Tente novamente." }, { status: 500 });
  }
}
