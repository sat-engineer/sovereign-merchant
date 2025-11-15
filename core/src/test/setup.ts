import { vi } from 'vitest';

// Mock better-sqlite3 globally for all tests
class MockDatabase {
  pragma = vi.fn();
  exec = vi.fn();
  close = vi.fn();

  prepare = vi.fn().mockImplementation((sql: string) => {
    // Mock the table query
    if (sql.includes('sqlite_master') && sql.includes('table')) {
      return {
        all: vi
          .fn()
          .mockReturnValue([
            { name: 'config' },
            { name: 'reconciliations' },
            { name: 'logs' },
            { name: 'webhook_configs' },
            { name: 'webhook_events' },
          ]),
      };
    }

    // Mock the table info query
    if (sql.includes('PRAGMA table_info')) {
      return {
        all: vi
          .fn()
          .mockReturnValue([
            { name: 'id' },
            { name: 'event_type' },
            { name: 'invoice_id' },
            { name: 'store_id' },
            { name: 'payload' },
            { name: 'processed' },
            { name: 'created_at' },
            { name: 'processed_at' },
          ]),
      };
    }

    // Default mock
    return {
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn(),
    };
  });
}

vi.mock('better-sqlite3', () => ({
  default: MockDatabase,
}));

export type { MockDatabase };
