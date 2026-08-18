import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { attachOwnerCookie, getOwnerId, OWNER_COOKIE } from "@/lib/device";
import { isTelegramConfigured } from "@/lib/telegram";

export async function GET() {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  const ownerId = getOwnerId(currentOwner);

  try {
    await ensureDatabaseSchema();
    const sql = getDatabase();
    const rows = await sql`
      SELECT telegram_username AS username
      FROM telegram_connections
      WHERE owner_id = ${ownerId}::uuid
    `;
    return attachOwnerCookie(NextResponse.json({
      configured: isTelegramConfigured(),
      connected: Boolean(rows[0]),
      username: rows[0]?.username || "",
    }), ownerId, Boolean(currentOwner));
  } catch (error) {
    console.error("Erro ao consultar integração Telegram:", error);
    return NextResponse.json({ error: "Não foi possível consultar o Telegram." }, { status: 500 });
  }
}
