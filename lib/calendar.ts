import { getDatabase } from "@/lib/db";

export type CalendarWindow = {
  date: string;
  endDate?: string;
  startTime: string;
  endTime?: string;
};

export type CalendarConflict = {
  id: string;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
};

export async function findCalendarConflicts(
  ownerId: string,
  event: CalendarWindow,
  excludeEventId?: string,
): Promise<CalendarConflict[]> {
  const sql = getDatabase();
  const endDate = event.endDate || event.date;
  const rows = await sql`
    SELECT
      id::text,
      title,
      event_date::text AS date,
      COALESCE(end_date, event_date)::text AS "endDate",
      to_char(start_time, 'HH24:MI') AS "startTime",
      COALESCE(to_char(end_time, 'HH24:MI'), to_char(start_time, 'HH24:MI')) AS "endTime"
    FROM agenda_events
    WHERE owner_id = ${ownerId}::uuid
      AND event_date <= ${endDate}::date
      AND COALESCE(end_date, event_date) >= ${event.date}::date
      AND start_time < COALESCE(${event.endTime || null}::time, ${event.startTime}::time + INTERVAL '1 hour')
      AND COALESCE(end_time, start_time + INTERVAL '1 hour') > ${event.startTime}::time
      AND (${excludeEventId || null}::uuid IS NULL OR id <> ${excludeEventId || null}::uuid)
    ORDER BY event_date, start_time
    LIMIT 5
  `;
  return rows as CalendarConflict[];
}
