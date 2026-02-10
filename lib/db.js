import { createClient } from "@libsql/client";

let client;

export function getDb() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:local.db",
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    // Init tables on first access (runs once per cold start)
    initTables();
  }
  return client;
}

async function initTables() {
  const db = client;
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'visitor',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_heartbeat TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      counselor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (visitor_id) REFERENCES agents(id),
      FOREIGN KEY (counselor_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (sender_id) REFERENCES agents(id)
    );
  `);
}

// Helper: run a query and return all rows
export async function queryAll(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  return result.rows;
}

// Helper: run a query and return first row
export async function queryOne(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

// Helper: run an insert/update/delete
export async function execute(sql, args = []) {
  const db = getDb();
  return db.execute({ sql, args });
}
