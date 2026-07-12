import { DATABASE_SCHEMA_VERSION, initializeDatabase, PlaniblyDatabase } from './database';

describe('PlaniblyDatabase', () => {
  it('opens at the declared version and writes schema metadata', async () => {
    const database = new PlaniblyDatabase(`planibly-test-${crypto.randomUUID()}`);

    await initializeDatabase(database);

    expect(database.verno).toBe(DATABASE_SCHEMA_VERSION);
    await expect(database.metadata.get('schemaVersion')).resolves.toMatchObject({
      value: String(DATABASE_SCHEMA_VERSION),
    });
    expect(database.tables.map((table) => table.name).sort()).toEqual(['diagnostics', 'metadata']);

    database.close();
    await database.delete();
  });
});
