import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { attachOwnerCookie, getOwnerId, OWNER_COOKIE } from "@/lib/device";

export const runtime = "nodejs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type EventInput = {
  title?: unknown;
  date?: unknown;
  endDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  location?: unknown;
  notes?: unknown;
  sourceText?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function databaseError(error: unknown) {
  console.error("Erro ao acessar os compromissos:", error);
  const missingDatabase = error instanceof Error && error.message === "DATABASE_URL_NOT_CONFIGURED";
  return NextResponse.json(
    {
      error: missingDatabase
        ? "O banco de dados ainda não foi conectado. Configure DATABASE_URL na Vercel."
        : "Não foi possível acessar a agenda agora.",
    },
    { status: missingDatabase ? 503 : 500 },
  );
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  const ownerId = getOwnerId(currentOwner);
  const date = request.nextUrl.searchParams.get("date") || "";
  const month = request.nextUrl.searchParams.get("month") || "";

  if (!month && !isValidDate(date)) {
    return NextResponse.json({ error: "Informe uma data ou mês válido." }, { status: 400 });
  }
  if (month && !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "Informe um mês válido." }, { status: 400 });
  }

  try {
    await ensureDatabaseSchema();
    const sql = getDatabase();
    const rows = month
      ? await sql`
          SELECT
            id::text,
            title,
            event_date::text AS date,
            COALESCE(end_date, event_date)::text AS "endDate",
            to_char(start_time, 'HH24:MI') AS "startTime",
            COALESCE(to_char(end_time, 'HH24:MI'), '') AS "endTime",
            location,
            notes
          FROM agenda_events
          WHERE owner_id = ${ownerId}::uuid
            AND event_date < ${`${month}-01`}::date + INTERVAL '1 month'
            AND COALESCE(end_date, event_date) >= ${`${month}-01`}::date
          ORDER BY event_date, start_time, created_at
        `
      : await sql`
          SELECT
            id::text,
            title,
            event_date::text AS date,
            COALESCE(end_date, event_date)::text AS "endDate",
            to_char(start_time, 'HH24:MI') AS "startTime",
            COALESCE(to_char(end_time, 'HH24:MI'), '') AS "endTime",
            location,
            notes
          FROM agenda_events
          WHERE owner_id = ${ownerId}::uuid
            AND event_date <= ${date}::date
            AND COALESCE(end_date, event_date) >= ${date}::date
          ORDER BY start_time, created_at
        `;
    return attachOwnerCookie(NextResponse.json({ events: rows }), ownerId, Boolean(currentOwner));
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  const ownerId = getOwnerId(currentOwner);

  try {
    const body = (await request.json()) as EventInput;
    const event = {
      title: text(body.title, 160),
      date: text(body.date, 10),
      endDate: text(body.endDate, 10) || text(body.date, 10),
      startTime: text(body.startTime, 5),
      endTime: text(body.endTime, 5),
      location: text(body.location, 240),
      notes: text(body.notes, 4000),
      sourceText: text(body.sourceText, 4000),
    };

    if (!event.title || !isValidDate(event.date) || !TIME_PATTERN.test(event.startTime)) {
      return NextResponse.json({ error: "Título, data e horário de início são obrigatórios." }, { status: 400 });
    }
    if (event.endTime && !TIME_PATTERN.test(event.endTime)) {
      return NextResponse.json({ error: "O horário de término é inválido." }, { status: 400 });
    }
    if (!isValidDate(event.endDate) || event.endDate < event.date) {
      return NextResponse.json({ error: "A data final deve ser igual ou posterior à data inicial." }, { status: 400 });
    }

    await ensureDatabaseSchema();
    const sql = getDatabase();
    const id = crypto.randomUUID();
    const rows = await sql`
      INSERT INTO agenda_events (
        id, owner_id, title, event_date, end_date, start_time, end_time, location, notes, source_text
      ) VALUES (
        ${id}::uuid,
        ${ownerId}::uuid,
        ${event.title},
        ${event.date}::date,
        ${event.endDate}::date,
        ${event.startTime}::time,
        ${event.endTime || null}::time,
        ${event.location},
        ${event.notes},
        ${event.sourceText}
      )
      RETURNING
        id::text,
        title,
        event_date::text AS date,
        COALESCE(end_date, event_date)::text AS "endDate",
        to_char(start_time, 'HH24:MI') AS "startTime",
        COALESCE(to_char(end_time, 'HH24:MI'), '') AS "endTime",
        location,
        notes
    `;
    return attachOwnerCookie(NextResponse.json({ event: rows[0] }, { status: 201 }), ownerId, Boolean(currentOwner));
  } catch (error) {
    return databaseError(error);
  }
}
