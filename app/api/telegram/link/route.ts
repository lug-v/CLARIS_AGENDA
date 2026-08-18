import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { attachOwnerCookie, getOwnerId, OWNER_COOKIE } from "@/lib/device";
import { ensureTelegramWebhook, getTelegramBotUsername, isTelegramConfigured } from "@/lib/telegram";

type LinkStage = "bot" | "webhook" | "database";

function linkErrorResponse(error: unknown, stage: LinkStage) {
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  const tokenRejected =
    detail.includes("unauthorized") ||
    detail.includes("not found") ||
    detail.includes("invalid token") ||
    detail.includes("token is invalid");

  if (tokenRejected) {
    return NextResponse.json(
      {
        code: "TELEGRAM_TOKEN_REJECTED",
        error: "O Telegram rejeitou o token do bot. Copie novamente somente o token HTTP API fornecido pelo @BotFather.",
      },
      { status: 502 },
    );
  }

  if (stage === "bot") {
    return NextResponse.json(
      {
        code: "TELEGRAM_BOT_VALIDATION_FAILED",
        error: "Não foi possível validar o bot no Telegram. Confira o token e tente novamente.",
      },
      { status: 502 },
    );
  }

  if (stage === "webhook") {
    return NextResponse.json(
      {
        code: "TELEGRAM_WEBHOOK_FAILED",
        error: "O Telegram recusou a conexão com o aplicativo. Confira a APP_URL e tente novamente.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      code: "TELEGRAM_DATABASE_FAILED",
      error: "Não foi possível preparar o vínculo no banco de dados.",
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  const ownerId = getOwnerId(currentOwner);

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "O bot do Telegram ainda não foi configurado." }, { status: 503 });
  }

  let stage: LinkStage = "bot";

  try {
    const username = await getTelegramBotUsername();

    stage = "webhook";
    await ensureTelegramWebhook(new URL(request.url).origin);

    stage = "database";
    await ensureDatabaseSchema();
    const sql = getDatabase();
    const code = crypto.randomUUID().replaceAll("-", "");
    await sql`DELETE FROM telegram_link_codes WHERE owner_id = ${ownerId}::uuid OR expires_at < NOW()`;
    await sql`
      INSERT INTO telegram_link_codes (code, owner_id, expires_at)
      VALUES (${code}, ${ownerId}::uuid, NOW() + INTERVAL '15 minutes')
    `;
    return attachOwnerCookie(
      NextResponse.json({ url: `https://t.me/${username}?start=${code}`, expiresInMinutes: 15 }),
      ownerId,
      Boolean(currentOwner),
    );
  } catch (error) {
    console.error(`Erro ao criar vínculo do Telegram na etapa ${stage}:`, error);
    return linkErrorResponse(error, stage);
  }
}
