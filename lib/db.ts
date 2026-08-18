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
          start_time TIME NOT NULL,
          end_time TIME,
          location VARCHAR(240) NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source_text TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS agenda_events_owner_date_idx
        ON agenda_events (owner_id, event_date, start_time)
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}
