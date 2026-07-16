import { CalendarValidationError, validateCalendarEvent } from './calendar';
import { database, type PlaniblyDatabase } from './database';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';
import type { CalendarEventRecord, CalendarRecord, DeletionReceipt } from './plannerTypes';

type Options = { now?: () => string; createId?: () => string; notify?: () => void };
const active = <T extends { deletedAt?: string }>(record: T) => record.deletedAt === undefined;
function changed() {
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}
function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

export class CalendarRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;
  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: Options = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? changed;
  }

  async createCalendar(name: string, color: string): Promise<CalendarRecord> {
    if (!name.trim()) throw new CalendarValidationError('Enter a calendar name.');
    const now = this.now();
    const activeCalendars = (await this.db.calendars.toArray()).filter(active);
    const record: CalendarRecord = {
      id: this.createId(),
      name: name.trim(),
      color,
      order: activeCalendars.length,
      isVisible: true,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.calendars.add(record);
    this.notify();
    return record;
  }
  async renameCalendar(id: string, name: string) {
    const calendar = await this.requireCalendar(id);
    await this.updateCalendar(calendar, { name });
  }
  async recolorCalendar(id: string, color: string) {
    const calendar = await this.requireCalendar(id);
    await this.updateCalendar(calendar, { color });
  }
  async setCalendarVisible(id: string, isVisible: boolean) {
    const calendar = await this.requireCalendar(id);
    await this.updateCalendar(calendar, { isVisible });
  }
  private async updateCalendar(
    calendar: CalendarRecord,
    patch: Partial<Pick<CalendarRecord, 'name' | 'color' | 'isVisible'>>,
  ) {
    if (patch.name !== undefined && !patch.name.trim())
      throw new CalendarValidationError('Enter a calendar name.');
    const update = { ...patch, modifiedAt: this.now() };
    if (patch.name !== undefined) update.name = patch.name.trim();
    await this.db.calendars.update(calendar.id, update);
    this.notify();
  }
  async reorderCalendar(id: string, direction: -1 | 1) {
    const records = (await this.db.calendars.toArray())
      .filter(active)
      .sort((a, b) => a.order - b.order);
    const index = records.findIndex((c) => c.id === id);
    const other = records[index + direction];
    if (!other) return;
    const now = this.now();
    await this.db.transaction('rw', this.db.calendars, () =>
      Promise.all([
        this.db.calendars.update(id, { order: other.order, modifiedAt: now }),
        this.db.calendars.update(other.id, { order: records[index]!.order, modifiedAt: now }),
      ]),
    );
    this.notify();
  }
  async saveEvent(
    input: Omit<
      CalendarEventRecord,
      'id' | 'createdAt' | 'modifiedAt' | 'deletedAt' | 'deletionGroupId'
    >,
    id?: string,
  ): Promise<CalendarEventRecord> {
    validateCalendarEvent(input);
    await this.requireCalendar(input.calendarId);
    const now = this.now();
    const existing = id ? await this.db.calendarEvents.get(id) : undefined;
    const record: CalendarEventRecord = {
      ...input,
      id: id ?? this.createId(),
      title: input.title.trim(),
      location: optionalText(input.location),
      notes: optionalText(input.notes),
      startTime: input.allDay ? undefined : input.startTime,
      endTime: input.allDay ? undefined : input.endTime,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    await this.db.calendarEvents.put(record);
    this.notify();
    return record;
  }
  async duplicateEvent(id: string) {
    const event = await this.requireEvent(id);
    return this.saveEvent({
      calendarId: event.calendarId,
      title: `${event.title} copy`,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      notes: event.notes,
    });
  }
  async deleteEvent(id: string): Promise<DeletionReceipt> {
    const event = await this.requireEvent(id);
    const deletedAt = this.now(),
      groupId = this.createId();
    await this.db.calendarEvents.update(id, {
      deletedAt,
      deletionGroupId: groupId,
      modifiedAt: deletedAt,
    });
    this.notify();
    return { groupId, kind: 'event', entityId: id, label: event.title, deletedAt };
  }
  async restoreEvent(id: string, calendarId?: string) {
    const event = await this.db.calendarEvents.get(id);
    if (!event?.deletedAt) throw new CalendarValidationError('Event is unavailable.');
    try {
      await this.requireCalendar(calendarId ?? event.calendarId);
    } catch {
      throw new CalendarValidationError('Choose an active calendar before restoring this event.');
    }
    await this.db.calendarEvents.update(id, {
      calendarId: calendarId ?? event.calendarId,
      deletedAt: undefined,
      deletionGroupId: undefined,
      modifiedAt: this.now(),
    });
    this.notify();
  }
  async permanentlyDeleteEvent(id: string) {
    await this.db.calendarEvents.delete(id);
    this.notify();
  }
  async deleteCalendar(
    id: string,
    mode: 'deleteEvents' | 'moveEvents',
    destinationId?: string,
  ): Promise<DeletionReceipt> {
    const calendar = await this.requireCalendar(id);
    if (mode === 'moveEvents') {
      if (!destinationId || destinationId === id)
        throw new CalendarValidationError('Choose another active calendar.');
      await this.requireCalendar(destinationId);
    }
    const deletedAt = this.now(),
      groupId = this.createId();
    const events = (await this.db.calendarEvents.where('calendarId').equals(id).toArray()).filter(
      active,
    );
    await this.db.transaction('rw', this.db.calendars, this.db.calendarEvents, async () => {
      await this.db.calendars.update(id, {
        deletedAt,
        deletionGroupId: groupId,
        modifiedAt: deletedAt,
      });
      if (mode === 'moveEvents')
        await this.db.calendarEvents.bulkPut(
          events.map((event) => ({ ...event, calendarId: destinationId!, modifiedAt: deletedAt })),
        );
      else
        await this.db.calendarEvents.bulkPut(
          events.map((event) => ({
            ...event,
            deletedAt,
            deletionGroupId: groupId,
            modifiedAt: deletedAt,
          })),
        );
    });
    this.notify();
    return {
      groupId,
      kind: 'calendar',
      entityId: id,
      label: calendar.name,
      deletedAt,
      movedEventIds: mode === 'moveEvents' ? events.map((event) => event.id) : undefined,
    };
  }
  async restoreCalendar(id: string) {
    const calendar = await this.db.calendars.get(id);
    if (!calendar?.deletedAt) throw new CalendarValidationError('Calendar is unavailable.');
    const groupId = calendar.deletionGroupId,
      now = this.now();
    await this.db.transaction('rw', this.db.calendars, this.db.calendarEvents, async () => {
      await this.db.calendars.update(id, {
        deletedAt: undefined,
        deletionGroupId: undefined,
        modifiedAt: now,
      });
      if (groupId) {
        const events = await this.db.calendarEvents
          .where('deletionGroupId')
          .equals(groupId)
          .toArray();
        await Promise.all(
          events
            .filter((event) => event.calendarId === id)
            .map((event) =>
              this.db.calendarEvents.update(event.id, {
                deletedAt: undefined,
                deletionGroupId: undefined,
                modifiedAt: now,
              }),
            ),
        );
      }
    });
    this.notify();
  }
  async restoreDeletionGroup(groupId: string, receipt?: DeletionReceipt) {
    const calendars = await this.db.calendars.where('deletionGroupId').equals(groupId).toArray();
    const events = await this.db.calendarEvents.where('deletionGroupId').equals(groupId).toArray();
    if (!calendars.length && !events.length)
      throw new CalendarValidationError('This deletion can no longer be undone.');
    const now = this.now();
    await this.db.transaction('rw', this.db.calendars, this.db.calendarEvents, async () => {
      await Promise.all(
        calendars.map((calendar) =>
          this.db.calendars.update(calendar.id, {
            deletedAt: undefined,
            deletionGroupId: undefined,
            modifiedAt: now,
          }),
        ),
      );
      const activeIds = new Set(
        (await this.db.calendars.toArray()).filter(active).map((calendar) => calendar.id),
      );
      await Promise.all(
        events
          .filter((event) => activeIds.has(event.calendarId))
          .map((event) =>
            this.db.calendarEvents.update(event.id, {
              deletedAt: undefined,
              deletionGroupId: undefined,
              modifiedAt: now,
            }),
          ),
      );
      if (receipt?.kind === 'calendar' && receipt.movedEventIds?.length) {
        const moved = await this.db.calendarEvents.bulkGet(receipt.movedEventIds);
        await this.db.calendarEvents.bulkPut(
          moved
            .filter((event): event is CalendarEventRecord => Boolean(event && active(event)))
            .map((event) => ({ ...event, calendarId: receipt.entityId, modifiedAt: now })),
        );
      }
    });
    this.notify();
  }
  async permanentlyDeleteCalendar(id: string) {
    const calendar = await this.db.calendars.get(id);
    if (!calendar?.deletedAt) throw new CalendarValidationError('Calendar is unavailable.');
    if (calendar.isProtected)
      throw new CalendarValidationError(
        'The protected default calendar cannot be permanently deleted.',
      );
    const events = await this.db.calendarEvents.where('calendarId').equals(id).toArray();
    await this.db.transaction('rw', this.db.calendars, this.db.calendarEvents, async () => {
      await this.db.calendarEvents.bulkDelete(events.map((event) => event.id));
      await this.db.calendars.delete(id);
    });
    this.notify();
  }
  async emptyRecentlyDeleted() {
    const calendars = (await this.db.calendars.toArray()).filter(
      (calendar) => calendar.deletedAt && !calendar.isProtected,
    );
    const events = (await this.db.calendarEvents.toArray()).filter((event) => event.deletedAt);
    await this.db.transaction('rw', this.db.calendars, this.db.calendarEvents, async () => {
      await this.db.calendarEvents.bulkDelete(events.map((event) => event.id));
      await this.db.calendars.bulkDelete(calendars.map((calendar) => calendar.id));
    });
    this.notify();
  }
  private async requireCalendar(id: string) {
    const calendar = await this.db.calendars.get(id);
    if (!calendar || !active(calendar))
      throw new CalendarValidationError('Calendar is unavailable.');
    return calendar;
  }
  private async requireEvent(id: string) {
    const event = await this.db.calendarEvents.get(id);
    if (!event || !active(event)) throw new CalendarValidationError('Event is unavailable.');
    return event;
  }
}
export const calendarRepository = new CalendarRepository();
