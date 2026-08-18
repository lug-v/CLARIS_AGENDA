import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { attachOwnerCookie, getOwnerId, OWNER_COOKIE } from "@/lib/device";
import { ensureTelegramWebhook, getTelegramBotUsername, isTelegramConfigured } from "@/lib/telegram";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  const ownerId = getOwnerId(currentOwner);

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "O bot do Telegram ainda não foi configurado." }, { status: 503 });
  }

  try {
    await ensureDatabaseSchema();
    const sql = getDatabase();
    const code = crypto.randomUUID().replaceAll("-", "");
    await sql`DELETE FROM telegram_link_codes WHERE owner_id = ${ownerId}::uuid OR expires_at < NOW()`;
    await sql`
      INSERT INTO telegram_link_codes (code, owner_id, expires_at)
      VALUES (${code}, ${ownerId}::uuid, NOW() + INTERVAL '15 minutes')
    `;
    await ensureTelegramWebhook(new URL(request.url).origin);
    const username = await getTelegramBotUsername();
    return attachOwnerCookie(
      NextResponse.json({ url: `https://t.me/${username}?start=${code}`, expiresInMinutes: 15 }),
      ownerId,
      Boolean(currentOwner),
    );
  } catch (error) {
    console.error("Erro ao criar vínculo do Telegram:", error);
    return NextResponse.json({ error: "Não foi possível gerar o vínculo com o Telegram." }, { status: 500 });
  }
}
