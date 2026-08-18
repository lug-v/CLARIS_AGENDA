import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { getOwnerId, OWNER_COOKIE } from "@/lib/device";

export async function POST() {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  if (!currentOwner) return NextResponse.json({ connected: false });
  const ownerId = getOwnerId(currentOwner);

  try {
    await ensureDatabaseSchema();
    const sql = getDatabase();
    await sql`DELETE FROM telegram_connections WHERE owner_id = ${ownerId}::uuid`;
    await sql`DELETE FROM telegram_link_codes WHERE owner_id = ${ownerId}::uuid`;
    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error("Erro ao desconectar Telegram:", error);
    return NextResponse.json({ error: "Não foi possível desconectar o Telegram." }, { status: 500 });
  }
}
