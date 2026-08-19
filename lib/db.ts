import { neon } from "@neondatabase/serverless";

let schemaReady: Promise<void> | null = null;

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL_NOT_CONFIGURED");
  }

  return neon(connectionString);
}

export function ensureDatabaseSchema() {
  if (!schemaReady) {
    const sql = getDatabase();
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agenda_events (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL,
          title VARCHAR(160) NOT NULL,
          event_date DATE NOT NULL,
          end_date DATE,
          start_time TIME NOT NULL,
          end_time TIME,
          location VARCHAR(240) NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source_text TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS end_date DATE`;
      await sql`ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS series_id UUID`;
      await sql`ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS occurrence_index INTEGER NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS recurrence_rule JSONB`;
      await sql`UPDATE agenda_events SET end_date = event_date WHERE end_date IS NULL`;
      await sql`
        CREATE INDEX IF NOT EXISTS agenda_events_owner_date_idx
        ON agenda_events (owner_id, event_date, start_time)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_connections (
          chat_id BIGINT PRIMARY KEY,
          owner_id UUID NOT NULL UNIQUE,
          telegram_user_id BIGINT NOT NULL,
          telegram_username VARCHAR(64) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_link_codes (
          code VARCHAR(64) PRIMARY KEY,
          owner_id UUID NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_pending_events (
          id UUID PRIMARY KEY,
          chat_id BIGINT NOT NULL,
          owner_id UUID NOT NULL,
          title VARCHAR(160) NOT NULL,
          event_date DATE NOT NULL,
          end_date DATE,
          start_time TIME NOT NULL,
          end_time TIME,
          location VARCHAR(240) NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source_text TEXT NOT NULL DEFAULT '',
          confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE telegram_pending_events ADD COLUMN IF NOT EXISTS end_date DATE`;
      await sql`ALTER TABLE telegram_pending_events ADD COLUMN IF NOT EXISTS recurrence VARCHAR(16) NOT NULL DEFAULT 'none'`;
      await sql`ALTER TABLE telegram_pending_events ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1`;
      await sql`ALTER TABLE telegram_pending_events ADD COLUMN IF NOT EXISTS recurrence_weekdays INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[]`;
      await sql`ALTER TABLE telegram_pending_events ADD COLUMN IF NOT EXISTS recurrence_until DATE`;
      await sql`ALTER TABLE telegram_pending_events ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 1`;
      await sql`UPDATE telegram_pending_events SET end_date = event_date WHERE end_date IS NULL`;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_updates (
          update_id BIGINT PRIMARY KEY,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS automation_preferences (
          owner_id UUID PRIMARY KEY,
          timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
          daily_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          daily_digest_hour SMALLINT NOT NULL DEFAULT 7 CHECK (daily_digest_hour BETWEEN 0 AND 23),
          reminder_offsets INTEGER[] NOT NULL DEFAULT ARRAY[1440, 60],
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS event_reminders (
          id UUID PRIMARY KEY,
          event_id UUID NOT NULL,
          owner_id UUID NOT NULL,
          kind VARCHAR(32) NOT NULL,
          remind_at TIMESTAMPTZ NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          sent_at TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (event_id, kind)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS event_reminders_due_idx
        ON event_reminders (status, remind_at)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS automation_deliveries (
          id UUID PRIMARY KEY,
          owner_id UUID NOT NULL,
          kind VARCHAR(48) NOT NULL,
          delivery_date DATE NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'processing',
          attempts INTEGER NOT NULL DEFAULT 1,
          sent_at TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (owner_id, kind, delivery_date)
        )
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}
