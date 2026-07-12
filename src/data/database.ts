import Dexie, { type EntityTable, type Transaction } from 'dexie';

export const DATABASE_NAME = 'planibly';
export const DATABASE_SCHEMA_VERSION = 1;

export type MetadataRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

export type DiagnosticRecord = {
  id: string;
  level: 'info' | 'warning' | 'error';
  event: string;
  message: string;
  context?: string;
  createdAt: string;
};

type SchemaVersion = {
  version: number;
  stores: Record<string, string>;
  migrate?: (transaction: Transaction) => Promise<void>;
};

// Add each future schema exactly once. Upgrade functions must be deterministic and local-only.
export const schemaVersions: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
    },
  },
];

export class PlaniblyDatabase extends Dexie {
  metadata!: EntityTable<MetadataRecord, 'key'>;
  diagnostics!: EntityTable<DiagnosticRecord, 'id'>;

  public constructor(name = DATABASE_NAME) {
    super(name);

    for (const schema of schemaVersions) {
      const version = this.version(schema.version).stores(schema.stores);
      if (schema.migrate) {
        version.upgrade(schema.migrate);
      }
    }
  }
}

export const database = new PlaniblyDatabase();

export async function initializeDatabase(db: PlaniblyDatabase = database): Promise<void> {
  await db.open();
  const now = new Date().toISOString();
  await db.metadata.bulkPut([
    { key: 'schemaVersion', value: String(DATABASE_SCHEMA_VERSION), updatedAt: now },
    { key: 'applicationName', value: 'Planibly', updatedAt: now },
  ]);
}
