import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export async function initializeDatabase(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'config.db');

  try {
    db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Create basic tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT,
        encrypted BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS reconciliations (
        id TEXT PRIMARY KEY,
        btcpay_invoice_id TEXT,
        quickbooks_transaction_id TEXT,
        amount_sats INTEGER,
        amount_fiat INTEGER, -- Stored in smallest currency unit (cents for USD, etc.)
        currency TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT,
        message TEXT,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
