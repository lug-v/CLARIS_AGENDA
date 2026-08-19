import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseSchema, getDatabase } from "@/lib/db";
import { attachOwnerCookie, getOwnerId, OWNER_COOKIE } from "@/lib/device";
import { findCalendarConflicts } from "@/lib/calendar";
import { scheduleDefaultReminders } from "@/lib/automations";
import { expandRecurrence, normalizeRecurrence } from "@/lib/recurrence";

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
  allowConflict?: unknown;
  recurrence?: unknown;
  recurrenceInterval?: unknown;
  recurrenceWeekdays?: unknown;
  recurrenceUntil?: unknown;
  recurrenceCount?: unknown;
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
      ...normalizeRecurrence({
        recurrence: text(body.recurrence, 16) as "none" | "daily" | "weekly" | "monthly",
        recurrenceInterval: Number(body.recurrenceInterval),
        recurrenceWeekdays: Array.isArray(body.recurrenceWeekdays) ? body.recurrenceWeekdays.map(Number) : [],
        recurrenceUntil: text(body.recurrenceUntil, 10),
        recurrenceCount: Number(body.recurrenceCount),
      }, text(body.date, 10)),
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
    const occurrences = expandRecurrence(event);
    const conflicts = (await Promise.all(occurrences.map(async (occurrence) => {
      const matches = await findCalendarConflicts(ownerId, { ...event, ...occurrence });
      return matches.map((match) => ({ ...match, occurrenceDate: occurrence.date }));
    }))).flat().slice(0, 10);
    if (conflicts.length && body.allowConflict !== true) {
      return attachOwnerCookie(
        NextResponse.json(
          {
            code: "EVENT_CONFLICT",
            error: `Já existe ${conflicts.length === 1 ? "um compromisso" : "mais de um compromisso"} nesse período.`,
            conflicts,
          },
          { status: 409 },
        ),
        ownerId,
        Boolean(currentOwner),
      );
    }
    const seriesId = event.recurrence === "none" ? null : crypto.randomUUID();
    const recurrenceRule = event.recurrence === "none" ? null : JSON.stringify({
      recurrence: event.recurrence,
      recurrenceInterval: event.recurrenceInterval,
      recurrenceWeekdays: event.recurrenceWeekdays,
      recurrenceUntil: event.recurrenceUntil,
      recurrenceCount: event.recurrenceCount,
    });
    const preparedOccurrences = occurrences.map((occurrence) => ({ id: crypto.randomUUID(), ...occurrence }));
    const rows = await sql`
      INSERT INTO agenda_events (
        id, owner_id, title, event_date, end_date, start_time, end_time, location, notes,
        source_text, series_id, occurrence_index, recurrence_rule
      )
      SELECT
        item.id::uuid, ${ownerId}::uuid, ${event.title}, item.date::date, item."endDate"::date,
        ${event.startTime}::time, ${event.endTime || null}::time, ${event.location}, ${event.notes},
        ${event.sourceText}, ${seriesId}::uuid, item."occurrenceIndex", ${recurrenceRule}::jsonb
      FROM jsonb_to_recordset(${JSON.stringify(preparedOccurrences)}::jsonb)
        AS item(id text, date text, "endDate" text, "occurrenceIndex" integer)
      RETURNING id::text, title, event_date::text AS date,
        COALESCE(end_date, event_date)::text AS "endDate",
        to_char(start_time, 'HH24:MI') AS "startTime",
        COALESCE(to_char(end_time, 'HH24:MI'), '') AS "endTime", location, notes, occurrence_index AS "occurrenceIndex"
    `;
    rows.sort((a, b) => Number(a.occurrenceIndex) - Number(b.occurrenceIndex));
    for (const occurrence of preparedOccurrences) {
      try {
        await scheduleDefaultReminders(ownerId, occurrence.id, { ...event, ...occurrence });
      } catch (reminderError) {
        console.error("Compromisso salvo, mas não foi possível preparar os lembretes:", reminderError);
      }
    }
    return attachOwnerCookie(
      NextResponse.json({ event: rows[0], events: rows, createdCount: preparedOccurrences.length }, { status: 201 }),
      ownerId,
      Boolean(currentOwner),
    );
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const currentOwner = cookieStore.get(OWNER_COOKIE)?.value;
  const ownerId = getOwnerId(currentOwner);
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Compromisso inválido." }, { status: 400 });
  }
  try {
    await ensureDatabaseSchema();
    const sql = getDatabase();
    const deleted = await sql`
      DELETE FROM agenda_events
      WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
      RETURNING id::text
    `;
    if (!deleted[0]) {
      return attachOwnerCookie(
        NextResponse.json({ error: "Compromisso não encontrado." }, { status: 404 }),
        ownerId,
        Boolean(currentOwner),
      );
    }
    await sql`DELETE FROM event_reminders WHERE event_id = ${id}::uuid AND owner_id = ${ownerId}::uuid`;
    return attachOwnerCookie(NextResponse.json({ deleted: true }), ownerId, Boolean(currentOwner));
  } catch (error) {
    return databaseError(error);
  }
}
