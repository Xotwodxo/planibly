import { CalendarRepository } from './calendarRepository';
import { initializeDatabase, PlaniblyDatabase } from './database';
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
