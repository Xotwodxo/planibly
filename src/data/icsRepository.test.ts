import { CalendarRepository } from './calendarRepository';
import { initializeDatabase, PlaniblyDatabase } from './database';
import { parseIcs } from './ics';
import { IcsRepository } from './icsRepository';

function icsEvent(summary: string, extra: string[] = []): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Fictional schedule',
    'BEGIN:VEVENT',
    'UID:fictional-import@example.test',
    `SUMMARY:${summary}`,
    'DTSTART:20260720T090000',
    'DTEND:20260720T100000',
    'SEQUENCE:1',
    ...extra,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function harness() {
  const database = new PlaniblyDatabase(`ics-repository-${crypto.randomUUID()}`);
  let id = 0;
  let tick = 0;
  const options = {
    createId: () => `b0000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => `2026-07-17T10:00:${String(tick++).padStart(2, '0')}.000Z`,
    notify: () => undefined,
  };
  return {
    database,
    repository: new IcsRepository(database, options),
    calendarRepository: new CalendarRepository(database, options),
  };
}

async function firstImport(repository: IcsRepository, contents = icsEvent('Planning call')) {
  const preview = await repository.previewImport(parseIcs(contents), { filename: 'fictional.ics' });
  const batch = await repository.applyImport({
    preview,
    destination: { kind: 'new', name: 'Imported diary', color: '#5B67C8' },
    resolutions: Object.fromEntries(
      preview.records.map((record) => [record.key, record.defaultResolution]),
    ),
    timezoneResolutions: {},
  });
  const history = await repository.getHistory();
  return { preview, batch, source: history.sources[0]! };
}

describe('ICS import repository', () => {
  it('previews without writing and applies a simple timed import transactionally', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const parsed = parseIcs(icsEvent('Planning call'));
    const preview = await repository.previewImport(parsed, { filename: 'fictional.ics' });
    expect(preview).toMatchObject({
      filename: 'fictional.ics',
      calendarName: 'Fictional schedule',
      validEventCount: 1,
      recurringSeriesCount: 0,
      duplicates: 0,
    });
    expect(await database.calendarEvents.count()).toBe(0);
    const { batch } = await firstImport(repository);
    expect(batch.validEventCount).toBe(1);
    await expect(database.calendarEvents.toArray()).resolves.toEqual([
      expect.objectContaining({ title: 'Planning call', startTime: '09:00' }),
    ]);
    expect(await database.externalEventMappings.count()).toBe(1);
    expect(await database.calendarImportSources.count()).toBe(1);
    database.close();
    await database.delete();
  });

  it('detects unchanged re-imports and does not create duplicate events', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const { source } = await firstImport(repository);
    const preview = await repository.previewImport(parseIcs(icsEvent('Planning call')), {
      filename: 'fictional.ics',
      sourceId: source.id,
    });
    expect(preview.records[0]?.classification).toBe('unchanged');
    await repository.applyImport({
      preview,
      destination: { kind: 'existing', calendarId: source.destinationCalendarId! },
      resolutions: {},
      timezoneResolutions: {},
    });
    expect(await database.calendarEvents.count()).toBe(1);
    expect((await repository.getHistory()).batches).toHaveLength(2);
    database.close();
    await database.delete();
  });

  it('reports local edits in import history after the import completes', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    await firstImport(repository);
    const imported = (await database.calendarEvents.toArray())[0]!;
    expect((await repository.getHistory()).sources[0]?.hasLocalChanges).toBe(false);
    await database.calendarEvents.update(imported.id, {
      title: 'Locally edited planning call',
      modifiedAt: '2026-07-17T11:00:00.000Z',
    });
    expect((await repository.getHistory()).sources[0]?.hasLocalChanges).toBe(true);
    database.close();
    await database.delete();
  });

  it('updates externally changed records while preserving the Planibly event ID', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const { source } = await firstImport(repository);
    const before = (await database.calendarEvents.toArray())[0]!;
    const preview = await repository.previewImport(parseIcs(icsEvent('Updated planning call')), {
      sourceId: source.id,
    });
    expect(preview.records[0]?.classification).toBe('updated');
    await repository.applyImport({
      preview,
      destination: { kind: 'existing', calendarId: source.destinationCalendarId! },
      resolutions: {},
      timezoneResolutions: {},
    });
    await expect(database.calendarEvents.get(before.id)).resolves.toMatchObject({
      title: 'Updated planning call',
    });
    expect(await database.calendarEvents.count()).toBe(1);
    database.close();
    await database.delete();
  });

  it('classifies local/external conflicts and keeps the local version by default', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const { source } = await firstImport(repository);
    const imported = (await database.calendarEvents.toArray())[0]!;
    await database.calendarEvents.update(imported.id, {
      title: 'My local title',
      modifiedAt: '2026-07-17T12:00:00.000Z',
    });
    const preview = await repository.previewImport(parseIcs(icsEvent('External title')), {
      sourceId: source.id,
    });
    expect(preview.records[0]?.classification).toBe('conflicting');
    await repository.applyImport({
      preview,
      destination: { kind: 'existing', calendarId: source.destinationCalendarId! },
      resolutions: {},
      timezoneResolutions: {},
    });
    await expect(database.calendarEvents.get(imported.id)).resolves.toMatchObject({
      title: 'My local title',
    });
    database.close();
    await database.delete();
  });

  it('detects duplicate UID identities in one preview', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const one = icsEvent('First').replace('END:VCALENDAR\r\n', '');
    const second = icsEvent('Second').replace(
      ['BEGIN:VCALENDAR\r\n', 'VERSION:2.0\r\n', 'X-WR-CALNAME:Fictional schedule\r\n'].join(''),
      '',
    );
    const preview = await repository.previewImport(parseIcs(`${one}${second}`));
    expect(preview.duplicates).toBe(1);
    expect(preview.records[1]?.classification).toBe('duplicate');
    database.close();
    await database.delete();
  });

  it('imports recurrence, EXDATE and occurrence overrides into Phase 3B records', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const contents = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:fictional-series@example.test',
      'SUMMARY:Review',
      'DTSTART:20260720T090000',
      'DTEND:20260720T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      'EXDATE:20260727T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:fictional-series@example.test',
      'RECURRENCE-ID:20260803T090000',
      'SUMMARY:Moved review',
      'DTSTART:20260804T110000',
      'DTEND:20260804T120000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:fictional-series@example.test',
      'RECURRENCE-ID:20260810T090000',
      'SUMMARY:Cancelled review',
      'DTSTART:20260810T090000',
      'DTEND:20260810T100000',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    await firstImport(repository, contents);
    expect(await database.recurrenceRules.count()).toBe(1);
    await expect(database.recurrenceExceptions.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalStartDate: '2026-07-27', kind: 'cancelled' }),
        expect.objectContaining({ originalStartDate: '2026-08-03', kind: 'override' }),
        expect.objectContaining({ originalStartDate: '2026-08-10', kind: 'cancelled' }),
      ]),
    );
    expect(await database.externalEventMappings.count()).toBe(4);
    database.close();
    await database.delete();
  });

  it('requires explicit approval before applying an external cancellation', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const { source } = await firstImport(repository);
    const imported = (await database.calendarEvents.toArray())[0]!;
    const preview = await repository.previewImport(
      parseIcs(icsEvent('Planning call', ['STATUS:CANCELLED'])),
      { sourceId: source.id },
    );
    expect(preview.records[0]).toMatchObject({
      classification: 'cancelled',
      defaultResolution: 'keepLocal',
    });
    await repository.applyImport({
      preview,
      destination: { kind: 'existing', calendarId: source.destinationCalendarId! },
      resolutions: {},
      timezoneResolutions: {},
    });
    expect((await database.calendarEvents.get(imported.id))?.deletedAt).toBeUndefined();
    await repository.applyImport({
      preview,
      destination: { kind: 'existing', calendarId: source.destinationCalendarId! },
      resolutions: { [preview.records[0]!.key]: 'useImported' },
      timezoneResolutions: {},
    });
    expect((await database.calendarEvents.get(imported.id))?.deletedAt).toBeDefined();
    database.close();
    await database.delete();
  });

  it('rolls back a failed import without partial calendar or provenance writes', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const preview = await repository.previewImport(parseIcs(icsEvent('Planning call')));
    await expect(
      repository.applyImport({
        preview,
        destination: { kind: 'existing', calendarId: 'missing' },
        resolutions: {},
        timezoneResolutions: {},
      }),
    ).rejects.toThrow('active calendar');
    expect(await database.calendarEvents.count()).toBe(0);
    expect(await database.calendarImportSources.count()).toBe(0);
    expect(await database.calendarImportBatches.count()).toBe(0);
    database.close();
    await database.delete();
  });

  it('removes history without deleting events and cleans mappings on permanent event deletion', async () => {
    const { database, repository, calendarRepository } = harness();
    await initializeDatabase(database);
    const { batch } = await firstImport(repository);
    const imported = (await database.calendarEvents.toArray())[0]!;
    await repository.removeHistoryBatch(batch.id);
    expect(await database.calendarEvents.count()).toBe(1);
    expect(await database.calendarImportBatches.count()).toBe(0);
    await calendarRepository.deleteEvent(imported.id);
    await calendarRepository.permanentlyDeleteEvent(imported.id);
    expect(await database.externalEventMappings.count()).toBe(0);
    database.close();
    await database.delete();
  });
});
