import { getDatabase } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

type DigestConnection = {
  chatId: string;
  ownerId: string;
  timezone: string;
};

type ReminderEvent = {
  id: string;
  chatId: string;
  title: string;
  date: string;
  startTime: string;
  location: string;
  kind: string;
};

type SchedulableEvent = {
  date: string;
  startTime: string;
};

function todayInTimezone(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00`));
}

function digestMessage(date: string, timezone: string, events: Record<string, unknown>[]) {
  const heading = `☀️ Bom dia! Agenda de ${formatDate(date, timezone)}`;
  if (!events.length) return `${heading}\n\nVocê não tem compromissos para hoje.`;
  const lines = events.map((event) => {
    const time = String(event.time || "");
    const title = String(event.title || "Compromisso");
    const location = event.location ? ` · ${event.location}` : "";
    return `${time} — ${title}${location}`;
  });
  return [heading, "", `${events.length} ${events.length === 1 ? "compromisso" : "compromissos"}:`, ...lines].join("\n");
}

export async function scheduleDefaultReminders(ownerId: string, eventId: string, event: SchedulableEvent) {
  const sql = getDatabase();
  await sql`
    INSERT INTO automation_preferences (owner_id)
    VALUES (${ownerId}::uuid)
    ON CONFLICT (owner_id) DO NOTHING
  `;
  const preferences = await sql`
    SELECT timezone, reminder_offsets AS "reminderOffsets"
    FROM automation_preferences
    WHERE owner_id = ${ownerId}::uuid
  `;
  const timezone = String(preferences[0]?.timezone || "America/Sao_Paulo");
  const offsets = Array.isArray(preferences[0]?.reminderOffsets)
    ? preferences[0].reminderOffsets.map(Number).filter((offset) => Number.isInteger(offset) && offset > 0)
    : [1440, 60];

  for (const offset of offsets) {
    await sql`
      INSERT INTO event_reminders (id, event_id, owner_id, kind, remind_at)
      SELECT
        ${crypto.randomUUID()}::uuid,
        ${eventId}::uuid,
        ${ownerId}::uuid,
        ${`offset_${offset}`},
        ((${event.date}::date + ${event.startTime}::time) AT TIME ZONE ${timezone}) - (${offset} * INTERVAL '1 minute')
      WHERE ((${event.date}::date + ${event.startTime}::time) AT TIME ZONE ${timezone}) - (${offset} * INTERVAL '1 minute') > NOW()
      ON CONFLICT (event_id, kind) DO NOTHING
    `;
  }
}

function reminderMessage(reminder: ReminderEvent) {
  const offset = Number(reminder.kind.replace("offset_", ""));
  const when = offset === 1440 ? "amanhã" : offset === 60 ? "em 1 hora" : `em ${offset} minutos`;
  return [
    `⏰ Lembrete: ${when}`,
    "",
    `${reminder.startTime} — ${reminder.title}`,
    reminder.location ? `Local: ${reminder.location}` : "",
  ].filter(Boolean).join("\n");
}

export async function runDueReminders() {
  const sql = getDatabase();
  const reminders = await sql`
    WITH due AS (
      SELECT id
      FROM event_reminders
      WHERE status IN ('pending', 'failed')
        AND remind_at <= NOW()
        AND attempts < 3
      ORDER BY remind_at
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    ), claimed AS (
      UPDATE event_reminders er
      SET status = 'processing', attempts = attempts + 1
      FROM due
      WHERE er.id = due.id
      RETURNING er.id, er.event_id, er.owner_id, er.kind
    )
    SELECT
      claimed.id::text,
      tc.chat_id::text AS "chatId",
      ae.title,
      ae.event_date::text AS date,
      to_char(ae.start_time, 'HH24:MI') AS "startTime",
      ae.location,
      claimed.kind
    FROM claimed
    JOIN agenda_events ae ON ae.id = claimed.event_id
    JOIN telegram_connections tc ON tc.owner_id = claimed.owner_id
  ` as ReminderEvent[];

  let sent = 0;
  let failed = 0;
  for (const reminder of reminders) {
    try {
      await sendTelegramMessage(reminder.chatId, reminderMessage(reminder));
      await sql`
        UPDATE event_reminders SET status = 'sent', sent_at = NOW(), last_error = ''
        WHERE id = ${reminder.id}::uuid
      `;
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida";
      await sql`
        UPDATE event_reminders SET status = 'failed', last_error = ${message}
        WHERE id = ${reminder.id}::uuid
      `;
      failed += 1;
    }
  }
  return { processed: reminders.length, sent, failed };
}

export async function runDailyDigests() {
  const sql = getDatabase();
  const connections = await sql`
    SELECT
      tc.chat_id::text AS "chatId",
      tc.owner_id::text AS "ownerId",
      COALESCE(ap.timezone, 'America/Sao_Paulo') AS timezone
    FROM telegram_connections tc
    LEFT JOIN automation_preferences ap ON ap.owner_id = tc.owner_id
    WHERE COALESCE(ap.daily_digest_enabled, TRUE) = TRUE
  ` as DigestConnection[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const connection of connections) {
    const date = todayInTimezone(connection.timezone);
    const deliveryId = crypto.randomUUID();
    const claimed = await sql`
      INSERT INTO automation_deliveries (id, owner_id, kind, delivery_date)
      VALUES (${deliveryId}::uuid, ${connection.ownerId}::uuid, 'daily_digest', ${date}::date)
      ON CONFLICT (owner_id, kind, delivery_date) DO NOTHING
      RETURNING id
    `;
    if (!claimed[0]) {
      skipped += 1;
      continue;
    }

    try {
      const events = await sql`
        SELECT title, to_char(start_time, 'HH24:MI') AS time, location
        FROM agenda_events
        WHERE owner_id = ${connection.ownerId}::uuid
          AND event_date <= ${date}::date
          AND COALESCE(end_date, event_date) >= ${date}::date
        ORDER BY start_time
      `;
      await sendTelegramMessage(connection.chatId, digestMessage(date, connection.timezone, events));
      await sql`
        UPDATE automation_deliveries
        SET status = 'sent', sent_at = NOW(), updated_at = NOW()
        WHERE id = ${deliveryId}::uuid
      `;
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida";
      await sql`
        UPDATE automation_deliveries
        SET status = 'failed', last_error = ${message}, updated_at = NOW()
        WHERE id = ${deliveryId}::uuid
      `;
      failed += 1;
    }
  }

  await sql`DELETE FROM automation_deliveries WHERE delivery_date < CURRENT_DATE - INTERVAL '90 days'`;
  return { processed: connections.length, sent, skipped, failed };
}
