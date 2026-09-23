import { DatabaseSync } from "node:sqlite";

export class SqliteTripStore {
  #database;

  constructor(databasePath) {
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA foreign_keys = ON");
    if (databasePath !== ":memory:") {
      this.#database.exec("PRAGMA journal_mode = WAL");
    }
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        trip_id TEXT,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        before_revision INTEGER,
        after_revision INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_log_trip_created
      ON audit_log (trip_id, created_at DESC);
    `);
  }

  saveTrip(trip) {
    this.#database
      .prepare(`
        INSERT INTO trips (id, snapshot, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          snapshot = excluded.snapshot,
          updated_at = excluded.updated_at
      `)
      .run(trip.id, JSON.stringify(trip), trip.updated_at);
    return structuredClone(trip);
  }

  getTrip(tripId) {
    const row = this.#database
      .prepare("SELECT snapshot FROM trips WHERE id = ?")
      .get(tripId);
    return row ? JSON.parse(row.snapshot) : null;
  }

  listTrips() {
    return this.#database
      .prepare("SELECT snapshot FROM trips ORDER BY updated_at DESC")
      .all()
      .map((row) => JSON.parse(row.snapshot));
  }

  setActiveTripId(tripId) {
    this.#database
      .prepare(`
        INSERT INTO app_state (key, value) VALUES ('active_trip_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(tripId);
  }

  getActiveTripId() {
    const row = this.#database
      .prepare("SELECT value FROM app_state WHERE key = 'active_trip_id'")
      .get();
    return row?.value ?? null;
  }

  appendAudit(entry) {
    this.#database
      .prepare(`
        INSERT INTO audit_log (
          id, trip_id, source, action, summary,
          before_revision, after_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.id,
        entry.trip_id,
        entry.source,
        entry.action,
        entry.summary,
        entry.before_revision,
        entry.after_revision,
        entry.created_at
      );
  }

  listAudit(tripId, limit = 30) {
    return this.#database
      .prepare(`
        SELECT id, trip_id, source, action, summary,
               before_revision, after_revision, created_at
        FROM audit_log
        WHERE trip_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(tripId, limit);
  }

  close() {
    this.#database.close();
  }
}
