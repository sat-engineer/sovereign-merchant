import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export async function initializeDatabase(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'config.db');

  try {
    db = new Database(dbPath);

    // Security and performance optimizations
    db.pragma('journal_mode = WAL'); // Write-Ahead Logging for concurrency
    db.pragma('foreign_keys = ON'); // Enable foreign key constraints
    db.pragma('synchronous = NORMAL'); // Balance performance vs safety
    db.pragma('cache_size = -64000'); // 64MB cache

    // Create basic tables with proper constraints
    db.exec(`
      -- Configuration storage with optional encryption
      -- Used for storing app settings, API keys, and other configuration
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,                    -- Unique configuration key
        value TEXT NOT NULL,                     -- Configuration value (may be encrypted)
        encrypted INTEGER DEFAULT 0,             -- Whether value is encrypted at rest (0=false, 1=true)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Payment reconciliation records
      -- Links BTCPayServer invoices to QuickBooks transactions
      CREATE TABLE IF NOT EXISTS reconciliations (
        id TEXT PRIMARY KEY,                     -- UUID for the reconciliation record
        btcpay_invoice_id TEXT UNIQUE,           -- BTCPayServer invoice ID (nullable until processed)
        quickbooks_transaction_id TEXT UNIQUE,   -- QuickBooks transaction ID (nullable until processed)
        amount_sats INTEGER NOT NULL,            -- Bitcoin amount in satoshis
        amount_fiat INTEGER NOT NULL,            -- Fiat amount in smallest currency unit (cents for USD)
        currency TEXT NOT NULL,                  -- Currency code (USD, EUR, etc.)
        status TEXT NOT NULL DEFAULT 'pending'  -- Status: pending, processing, completed, failed
          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,                   -- When reconciliation was completed
        error_message TEXT                       -- Error details if status is 'failed'
      );

      -- Application logs for debugging and monitoring
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL                      -- Log level: debug, info, warn, error
          CHECK (level IN ('debug', 'info', 'warn', 'error')),
        message TEXT NOT NULL,                   -- Log message
        data TEXT,                               -- Optional JSON data payload
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- BTCPayServer webhook configurations
      -- Stores webhook secrets and metadata for validation
      CREATE TABLE IF NOT EXISTS webhook_configs (
        id TEXT PRIMARY KEY,                     -- Unique webhook ID (from BTCPayServer)
        url TEXT NOT NULL,                       -- Webhook URL
        secret TEXT NOT NULL,                    -- Webhook secret for signature validation
        events TEXT NOT NULL,                    -- JSON array of enabled events
        active INTEGER DEFAULT 1,                -- Whether webhook is active (0=false, 1=true)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- BTCPayServer webhook events
      -- Stores incoming webhook notifications from BTCPayServer
      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,                     -- Webhook delivery ID from BTCPayServer
        event_type TEXT NOT NULL,                -- Event type (invoice_created, invoice_paid, etc.)
        invoice_id TEXT,                         -- BTCPayServer invoice ID
        store_id TEXT,                           -- BTCPayServer store ID
        payload TEXT NOT NULL,                   -- Full webhook payload as JSON
        processed INTEGER DEFAULT 0,             -- Whether this event has been processed (0=false, 1=true)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME                    -- When the event was processed
      );

      -- Add indexes for performance (to be implemented later)
      -- CREATE INDEX idx_reconciliations_status ON reconciliations(status);
      -- CREATE INDEX idx_reconciliations_created_at ON reconciliations(created_at);
      -- CREATE INDEX idx_logs_level_created_at ON logs(level, created_at);
    `);

    // Verify database file has correct permissions
    const fs = await import('fs');
    try {
      await fs.promises.access(dbPath, fs.constants.R_OK | fs.constants.W_OK);
      console.log('✅ Database file permissions verified');
    } catch (error) {
      console.warn('⚠️  Database file permission check failed:', error);
    }

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

// Test helper function to reset database state
export function _resetDatabaseForTesting(): void {
  if (db) {
    db.close();
  }
  db = null;
}
