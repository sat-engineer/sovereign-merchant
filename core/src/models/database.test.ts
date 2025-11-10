import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase, getDatabase, _resetDatabaseForTesting } from './database';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      pragma: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn(),
        get: vi.fn(),
      }),
      close: vi.fn(),
    })),
  };
});

const mockedDatabase = vi.mocked(Database);

describe('Database', () => {
  let mockDb: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the database state for testing
    _resetDatabaseForTesting();
    mockDb = {
      pragma: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn(),
        get: vi.fn(),
      }),
      close: vi.fn(),
    };
    mockedDatabase.mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initializeDatabase', () => {
    it('should initialize database with correct schema', async () => {
      await initializeDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
      expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON');
      expect(mockDb.pragma).toHaveBeenCalledWith('synchronous = NORMAL');
      expect(mockDb.pragma).toHaveBeenCalledWith('cache_size = -64000');
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS config')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS reconciliations')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS logs')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS webhook_events')
      );
    });

    it('should handle database initialization errors', async () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(initializeDatabase()).rejects.toThrow('Database error');
    });
  });

  describe('webhook_events table', () => {
    it('should include webhook_events table in schema', async () => {
      await initializeDatabase();

      const execCall = mockDb.exec.mock.calls.find((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('CREATE TABLE IF NOT EXISTS webhook_events')
      );

      expect(execCall).toBeDefined();
      expect(execCall[0]).toContain('id TEXT PRIMARY KEY');
      expect(execCall[0]).toContain('event_type TEXT NOT NULL');
      expect(execCall[0]).toContain('invoice_id TEXT');
      expect(execCall[0]).toContain('store_id TEXT');
      expect(execCall[0]).toContain('payload TEXT NOT NULL');
      expect(execCall[0]).toContain('processed BOOLEAN DEFAULT FALSE');
      expect(execCall[0]).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      expect(execCall[0]).toContain('processed_at DATETIME');
    });
  });

  describe('getDatabase', () => {
    it('should throw error when database not initialized', () => {
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('should return database instance when initialized', async () => {
      await initializeDatabase();
      const db = getDatabase();
      expect(db).toBe(mockDb);
    });
  });
});
