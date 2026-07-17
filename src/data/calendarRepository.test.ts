import { CalendarRepository } from './calendarRepository';
import { initializeDatabase, PlaniblyDatabase } from './database';
import { expandCalendarOccurrences } from './recurrence';
import { DEFAULT_CALENDAR_ID } from './plannerTypes';

function harness() {
  const database = new PlaniblyDatabase(`calendar-${crypto.randomUUID()}`);
  let id = 0,
    tick = 0;
  const repository = new CalendarRepository(database, {
    createId: () => `91000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => `2026-03-01T10:00:${String(tick++).padStart(2, '0')}.000Z`,
    notify: () => undefined,
  });
  return { database, repository };
}
const timed = (calendarId: string, title = 'Dentist') => ({
  calendarId,
  title,
  startDate: '2026-03-29',
  endDate: '2026-03-29',
  allDay: false,
  startTime: '09:00',
  endTime: '10:00',
  location: 'Town',
  notes: 'Bring details',
});

describe('Phase 3A calendar repository', () => {
  it('creates, renames, recolours, reorders and hides calendars', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const work = await repository.createCalendar('Work', '#3D9F98');
    await repository.renameCalendar(work.id, 'Coreframe');
    await repository.recolorCalendar(work.id, '#CE9138');
    await repository.setCalendarVisible(work.id, false);
    await repository.reorderCalendar(work.id, -1);
    await expect(database.calendars.get(work.id)).resolves.toMatchObject({
      name: 'Coreframe',
      color: '#CE9138',
      isVisible: false,
      order: 0,
    });
    database.close();
    await database.delete();
  });
  it('creates, edits, duplicates, moves, soft-deletes, restores and permanently deletes events', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const work = await repository.createCalendar('Work', '#3D9F98');
    const event = await repository.saveEvent(timed(DEFAULT_CALENDAR_ID));
    await repository.saveEvent({ ...timed(work.id), title: 'Moved' }, event.id);
    const duplicate = await repository.duplicateEvent(event.id);
    expect(duplicate.calendarId).toBe(work.id);
    const receipt = await repository.deleteEvent(event.id);
    expect((await database.calendarEvents.get(event.id))?.deletionGroupId).toBe(receipt.groupId);
    await repository.restoreEvent(event.id);
    expect((await database.calendarEvents.get(event.id))?.deletedAt).toBeUndefined();
    await repository.deleteEvent(event.id);
    await repository.permanentlyDeleteEvent(event.id);
    expect(await database.calendarEvents.get(event.id)).toBeUndefined();
    database.close();
    await database.delete();
  });
  it('requires an explicit non-empty calendar deletion choice and restores grouped events', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const work = await repository.createCalendar('Work', '#3D9F98');
    const event = await repository.saveEvent(timed(work.id));
    await expect(repository.deleteCalendar(work.id, 'moveEvents')).rejects.toThrow(
      'another active calendar',
    );
    await repository.deleteCalendar(work.id, 'deleteEvents');
    expect((await database.calendarEvents.get(event.id))?.deletedAt).toBeDefined();
    await repository.restoreCalendar(work.id);
    expect((await database.calendarEvents.get(event.id))?.deletedAt).toBeUndefined();
    database.close();
    await database.delete();
  });
  it('undoes a calendar deletion that moved events by returning them to the restored calendar', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const work = await repository.createCalendar('Work', '#3D9F98');
    const event = await repository.saveEvent(timed(work.id));
    const receipt = await repository.deleteCalendar(work.id, 'moveEvents', DEFAULT_CALENDAR_ID);
    expect((await database.calendarEvents.get(event.id))?.calendarId).toBe(DEFAULT_CALENDAR_ID);
    await repository.restoreDeletionGroup(receipt.groupId, receipt);
    expect((await database.calendarEvents.get(event.id))?.calendarId).toBe(work.id);
    database.close();
    await database.delete();
  });
  it('requires an active replacement when restoring into a deleted calendar and protects the default from permanent deletion', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const event = await repository.saveEvent(timed(DEFAULT_CALENDAR_ID));
    await repository.deleteEvent(event.id);
    await repository.deleteCalendar(DEFAULT_CALENDAR_ID, 'deleteEvents');
    await expect(repository.restoreEvent(event.id)).rejects.toThrow('active calendar');
    await expect(repository.permanentlyDeleteCalendar(DEFAULT_CALENDAR_ID)).rejects.toThrow(
      'protected',
    );
    database.close();
    await database.delete();
  });
  it('rejects invalid timed events', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    await expect(
      repository.saveEvent({ ...timed(DEFAULT_CALENDAR_ID), endTime: '08:00' }),
    ).rejects.toThrow('end after');
    database.close();
    await database.delete();
  });
});

describe('Phase 3B recurring series and templates', () => {
  async function occurrences(database: PlaniblyDatabase, start: string, end: string) {
    return expandCalendarOccurrences(
      {
        calendars: await database.calendars.toArray(),
        calendarEvents: (await database.calendarEvents.toArray()).filter(
          (event) => !event.deletedAt,
        ),
        recurrenceRules: await database.recurrenceRules.toArray(),
        recurrenceExceptions: await database.recurrenceExceptions.toArray(),
      },
      start,
      end,
    );
  }

  it('creates a series and edits or cancels one stable occurrence with undo', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const series = await repository.saveEventWithRecurrence(timed(DEFAULT_CALENDAR_ID), {
      frequency: 'daily',
      interval: 1,
      endMode: 'count',
      occurrenceCount: 4,
    });
    const second = (await occurrences(database, '2026-03-29', '2026-04-02'))[1]!;
    await repository.editRecurringOccurrence(
      second,
      {
        ...timed(DEFAULT_CALENDAR_ID, 'Moved dentist'),
        startDate: '2026-04-05',
        endDate: '2026-04-05',
      },
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 4 },
      'occurrence',
    );
    const moved = await occurrences(database, '2026-03-29', '2026-04-05');
    expect(moved.find((item) => item.originalStartDate === '2026-03-30')).toMatchObject({
      title: 'Moved dentist',
      startDate: '2026-04-05',
    });
    const receipt = await repository.deleteRecurringOccurrence(moved[0]!, 'occurrence');
    expect(
      (await occurrences(database, '2026-03-29', '2026-04-05')).some(
        (item) => item.originalStartDate === '2026-03-29',
      ),
    ).toBe(false);
    await repository.restoreDeletionGroup(receipt.groupId, receipt);
    expect(
      (await occurrences(database, '2026-03-29', '2026-04-05')).some(
        (item) => item.originalStartDate === '2026-03-29',
      ),
    ).toBe(true);
    expect(await database.recurrenceRules.where('eventId').equals(series.id).count()).toBe(1);
    database.close();
    await database.delete();
  });

  it('transactionally splits this and future without duplicating the boundary', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    await repository.saveEventWithRecurrence(timed(DEFAULT_CALENDAR_ID), {
      frequency: 'daily',
      interval: 1,
      endMode: 'count',
      occurrenceCount: 6,
    });
    const beforeSplit = await occurrences(database, '2026-03-29', '2026-04-05');
    await repository.editRecurringOccurrence(
      beforeSplit[3]!,
      {
        ...timed(DEFAULT_CALENDAR_ID, 'Future override'),
        startDate: '2026-04-01',
        endDate: '2026-04-01',
      },
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 6 },
      'occurrence',
    );
    const third = (await occurrences(database, '2026-03-29', '2026-04-05'))[2]!;
    await repository.editRecurringOccurrence(
      third,
      {
        ...timed(DEFAULT_CALENDAR_ID, 'Later series'),
        startDate: '2026-04-02',
        endDate: '2026-04-02',
      },
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 4 },
      'future',
    );
    const expanded = await occurrences(database, '2026-03-29', '2026-04-10');
    expect(expanded.map((item) => item.startDate)).toEqual([
      '2026-03-29',
      '2026-03-30',
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
    ]);
    expect(await database.recurrenceRules.count()).toBe(2);
    expect(expanded.find((item) => item.startDate === '2026-04-03')?.title).toBe('Future override');
    const exceptions = await database.recurrenceExceptions.toArray();
    expect(exceptions[0]?.seriesEventId).not.toBe(third.sourceEventId);
    database.close();
    await database.delete();
  });

  it('shortens this and future with same-session undo and cleans exceptions on permanent deletion', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const series = await repository.saveEventWithRecurrence(timed(DEFAULT_CALENDAR_ID), {
      frequency: 'daily',
      interval: 1,
      endMode: 'never',
    });
    const third = (await occurrences(database, '2026-03-29', '2026-04-02'))[2]!;
    const receipt = await repository.deleteRecurringOccurrence(third, 'future');
    expect(await occurrences(database, '2026-03-29', '2026-04-10')).toHaveLength(2);
    await repository.restoreDeletionGroup(receipt.groupId, receipt);
    expect(await occurrences(database, '2026-03-29', '2026-04-02')).toHaveLength(5);
    const first = (await occurrences(database, '2026-03-29', '2026-03-29'))[0]!;
    await repository.deleteRecurringOccurrence(first, 'occurrence');
    await repository.deleteEvent(series.id);
    await repository.permanentlyDeleteEvent(series.id);
    expect(await database.recurrenceRules.where('eventId').equals(series.id).count()).toBe(0);
    expect(
      await database.recurrenceExceptions.where('seriesEventId').equals(series.id).count(),
    ).toBe(0);
    database.close();
    await database.delete();
  });

  it('soft-deletes and restores a full series with its valid exceptions', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const series = await repository.saveEventWithRecurrence(timed(DEFAULT_CALENDAR_ID), {
      frequency: 'daily',
      interval: 1,
      endMode: 'count',
      occurrenceCount: 2,
    });
    const occurrence = (await occurrences(database, '2026-03-29', '2026-03-30'))[0]!;
    await repository.editRecurringOccurrence(
      occurrence,
      { ...timed(DEFAULT_CALENDAR_ID), title: 'Overridden' },
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 2 },
      'occurrence',
    );
    await repository.deleteEvent(series.id);
    expect((await database.recurrenceExceptions.toArray())[0]?.deletedAt).toBeDefined();
    await repository.restoreEvent(series.id);
    expect((await database.recurrenceExceptions.toArray())[0]?.deletedAt).toBeUndefined();
    expect((await occurrences(database, '2026-03-29', '2026-03-30'))[0]?.title).toBe('Overridden');
    database.close();
    await database.delete();
  });

  it('moves recurring series and explicit override calendars with calendar deletion and undo', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const work = await repository.createCalendar('Work', '#3D9F98');
    await repository.saveEventWithRecurrence(timed(work.id), {
      frequency: 'daily',
      interval: 1,
      endMode: 'count',
      occurrenceCount: 2,
    });
    const occurrence = (await occurrences(database, '2026-03-29', '2026-03-30'))[0]!;
    await repository.editRecurringOccurrence(
      occurrence,
      timed(work.id, 'Override'),
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 2 },
      'occurrence',
    );
    const receipt = await repository.deleteCalendar(work.id, 'moveEvents', DEFAULT_CALENDAR_ID);
    expect((await database.recurrenceExceptions.toArray())[0]?.calendarId).toBe(
      DEFAULT_CALENDAR_ID,
    );
    await repository.restoreDeletionGroup(receipt.groupId, receipt);
    expect((await database.recurrenceExceptions.toArray())[0]?.calendarId).toBe(work.id);
    database.close();
    await database.delete();
  });

  it('creates, edits, duplicates, reorders, soft-deletes, restores and permanently deletes templates', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const first = await repository.saveTemplate({
      name: 'Dentist',
      title: 'Dentist appointment',
      calendarId: DEFAULT_CALENDAR_ID,
      allDay: false,
      startTime: '09:00',
      suggestedDurationMinutes: 60,
      recurrence: {
        frequency: 'yearly',
        interval: 1,
        yearlyMonth: 3,
        yearlyDay: 29,
        endMode: 'never',
      },
    });
    const second = await repository.duplicateTemplate(first.id);
    await repository.reorderTemplate(second.id, -1);
    await repository.saveTemplate({ ...first, name: 'Annual dentist' }, first.id);
    const resolved = await repository.resolveTemplate(first.id, '2027-03-29');
    expect(resolved.input).toMatchObject({ title: 'Dentist appointment', endTime: '10:00' });
    const receipt = await repository.deleteTemplate(first.id);
    await repository.restoreDeletionGroup(receipt.groupId, receipt);
    expect((await database.eventTemplates.get(first.id))?.deletedAt).toBeUndefined();
    await repository.deleteTemplate(first.id);
    await repository.permanentlyDeleteTemplate(first.id);
    expect(await database.eventTemplates.get(first.id)).toBeUndefined();
    database.close();
    await database.delete();
  });

  it('falls back from an unavailable template calendar without changing existing events', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const work = await repository.createCalendar('Work', '#3D9F98');
    const template = await repository.saveTemplate({
      name: 'Call',
      title: 'Client call',
      calendarId: work.id,
      allDay: false,
      startTime: '11:00',
      endTime: '11:30',
    });
    await repository.deleteCalendar(work.id, 'moveEvents', DEFAULT_CALENDAR_ID);
    await expect(repository.resolveTemplate(template.id, '2026-05-01')).resolves.toMatchObject({
      fellBack: true,
      input: { calendarId: DEFAULT_CALENDAR_ID, startDate: '2026-05-01' },
    });
    database.close();
    await database.delete();
  });
});
