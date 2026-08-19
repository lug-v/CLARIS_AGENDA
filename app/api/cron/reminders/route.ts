import { ensureDatabaseSchema } from "@/lib/db";
import { runDueReminders } from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    await ensureDatabaseSchema();
    return Response.json({ ok: true, ...(await runDueReminders()) });
  } catch (error) {
    console.error("Erro ao executar lembretes:", error);
    return Response.json({ error: "Não foi possível executar os lembretes." }, { status: 500 });
  }
}
