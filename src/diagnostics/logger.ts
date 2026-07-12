import { database, type DiagnosticRecord } from '../data/database';

export type DiagnosticLevel = DiagnosticRecord['level'];

const MAX_DIAGNOSTIC_RECORDS = 200;

function describe(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return 'An unprintable value was reported.';
  }
}

export async function logDiagnostic(
  level: DiagnosticLevel,
  event: string,
  detail: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const record: DiagnosticRecord = {
    id: crypto.randomUUID(),
    level,
    event,
    message: describe(detail),
    context: context ? describe(context) : undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    await database.diagnostics.add(record);
    const overflow = (await database.diagnostics.count()) - MAX_DIAGNOSTIC_RECORDS;
    if (overflow > 0) {
      const oldestKeys = await database.diagnostics
        .orderBy('createdAt')
        .limit(overflow)
        .primaryKeys();
      await database.diagnostics.bulkDelete(oldestKeys);
    }
  } catch (loggingError) {
    console.error('Planibly could not save a local diagnostic.', loggingError, record);
  }
}
