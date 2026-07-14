import Dexie, { type EntityTable, type Transaction } from 'dexie';

import {
  INBOX_LIST_ID,
  STARTER_AREAS,
  STARTER_DATA_VERSION,
  type AreaRecord,
  type PlanListRecord,
  type TaskRecord,
} from './plannerTypes';

export const DATABASE_NAME = 'planibly';
export const DATABASE_SCHEMA_VERSION = 3;

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
  {
    version: 2,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks: '&id, listId, [listId+order], status, createdAt, modifiedAt, deletedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '2',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 3,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '3',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
];

export class PlaniblyDatabase extends Dexie {
  metadata!: EntityTable<MetadataRecord, 'key'>;
  diagnostics!: EntityTable<DiagnosticRecord, 'id'>;
  areas!: EntityTable<AreaRecord, 'id'>;
  lists!: EntityTable<PlanListRecord, 'id'>;
  tasks!: EntityTable<TaskRecord, 'id'>;

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

export async function initializeStarterData(db: PlaniblyDatabase = database): Promise<void> {
  await db.transaction('rw', db.metadata, db.areas, db.lists, async () => {
    const marker = await db.metadata.get('starterDataVersion');
    if (Number(marker?.value ?? 0) >= STARTER_DATA_VERSION) return;

    const now = new Date().toISOString();
    await db.areas.bulkAdd(
      STARTER_AREAS.map((area, order) => ({
        ...area,
        order,
        createdAt: now,
        modifiedAt: now,
      })),
    );
    await db.lists.add({
      id: INBOX_LIST_ID,
      areaId: null,
      name: 'Inbox',
      color: '#5B67C8',
      order: 0,
      systemType: 'inbox',
      createdAt: now,
      modifiedAt: now,
    });
    await db.metadata.put({
      key: 'starterDataVersion',
      value: String(STARTER_DATA_VERSION),
      updatedAt: now,
    });
  });
}

export async function initializeDatabase(db: PlaniblyDatabase = database): Promise<void> {
  await db.open();
  const now = new Date().toISOString();
  await db.metadata.bulkPut([
    { key: 'schemaVersion', value: String(DATABASE_SCHEMA_VERSION), updatedAt: now },
    { key: 'applicationName', value: 'Planibly', updatedAt: now },
  ]);
  await initializeStarterData(db);
}
