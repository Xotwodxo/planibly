import { database, type PlaniblyDatabase } from './database';
import { isLocalDate } from './planning';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';
import { routineItemsForDate, routineVariantForDate } from './routine';
import type { DeletionReceipt } from './plannerTypes';
import type {
  RoutineInput,
  RoutineItemRecord,
  RoutineOccurrenceAdjustmentRecord,
  RoutinePresentationStyle,
  RoutineRecord,
  RoutineRunItemRecord,
  RoutineRunRecord,
  RoutineVariantRecord,
} from './routineTypes';

const ROUTINE_STARTER_DATA_VERSION = 1;
const STARTER_ROUTINE_IDS = {
  morning: 'c1000000-0000-4000-8000-000000000001',
  evening: 'c1000000-0000-4000-8000-000000000002',
  leaving: 'c1000000-0000-4000-8000-000000000003',
} as const;
const STARTER_ITEM_PREFIXES: Record<string, string> = {
  [STARTER_ROUTINE_IDS.morning]: 'c2000000-0000-4000-8000-',
  [STARTER_ROUTINE_IDS.evening]: 'c3000000-0000-4000-8000-',
  [STARTER_ROUTINE_IDS.leaving]: 'c4000000-0000-4000-8000-',
};

type Options = { now?: () => string; createId?: () => string; notify?: () => void };

export class RoutineValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RoutineValidationError';
  }
}

export class UnfinishedRoutineError extends Error {
  public constructor() {
    super('Confirm completion while routine items remain unfinished.');
    this.name = 'UnfinishedRoutineError';
  }
}

function active<T extends { deletedAt?: string }>(record: T): boolean {
  return record.deletedAt === undefined;
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  return cleaned;
}

function validateDuration(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 1440)) {
    throw new RoutineValidationError(`${label} must be a whole number from 1 to 1,440 minutes.`);
  }
}

function validateInput(input: RoutineInput): void {
  if (!input.name.trim()) throw new RoutineValidationError('Enter a routine name.');
  if (!input.color) throw new RoutineValidationError('Choose a routine colour.');
  validateDuration(input.expectedDurationMinutes, 'Expected duration');
  if (input.items.length === 0 || input.items.every((item) => !item.isActive)) {
    throw new RoutineValidationError('Add at least one active routine item.');
  }
  const itemIds = new Set<string>();
  const activeItemIds = new Set<string>();
  for (const item of input.items) {
    if (!item.id || itemIds.has(item.id))
      throw new RoutineValidationError('Routine item IDs must be unique.');
    if (!item.title.trim()) throw new RoutineValidationError('Every routine item needs a title.');
    validateDuration(item.estimatedDurationMinutes, 'Item duration');
    itemIds.add(item.id);
    if (item.isActive) activeItemIds.add(item.id);
  }
  if (input.scheduleKind === 'selected' && input.selectedWeekdays.length === 0) {
    throw new RoutineValidationError('Choose at least one scheduled weekday.');
  }
  if (
    input.selectedWeekdays.some(
      (weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6,
    )
  ) {
    throw new RoutineValidationError('Scheduled weekdays are invalid.');
  }
  const variantWeekdays = new Set<number>();
  const variantIds = new Set<string>();
  for (const variant of input.variants) {
    if (!variant.id || variantIds.has(variant.id)) {
      throw new RoutineValidationError('Variant IDs must be unique.');
    }
    variantIds.add(variant.id);
    if (!variant.name.trim()) throw new RoutineValidationError('Every variant needs a name.');
    if (variant.weekdays.length === 0) {
      throw new RoutineValidationError('Choose at least one weekday for each variant.');
    }
    if (variant.itemIds.length === 0 || variant.itemIds.some((id) => !itemIds.has(id))) {
      throw new RoutineValidationError('Each variant must contain valid routine items.');
    }
    if (!variant.itemIds.some((id) => activeItemIds.has(id))) {
      throw new RoutineValidationError('Each variant needs at least one active routine item.');
    }
    for (const weekday of variant.weekdays) {
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new RoutineValidationError('Variant weekdays are invalid.');
      }
      if (variantWeekdays.has(weekday)) {
        throw new RoutineValidationError('A weekday can belong to only one variant in a routine.');
      }
      variantWeekdays.add(weekday);
    }
  }
}

export class RoutineRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: Options = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify =
      options.notify ?? (() => window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT)));
  }

  public async starterExamplesAvailable(): Promise<boolean> {
    return !(await this.db.metadata.get('routineStarterDataVersion'));
  }

  public async createStarterExamples(): Promise<RoutineRecord[]> {
    const created: RoutineRecord[] = [];
    await this.db.transaction(
      'rw',
      [this.db.metadata, this.db.routines, this.db.routineItems],
      async () => {
        if (await this.db.metadata.get('routineStarterDataVersion')) return;
        const now = this.now();
        const definitions = [
          {
            id: STARTER_ROUTINE_IDS.morning,
            name: 'Morning routine',
            color: '#5B67C8',
            description: 'A small editable start to the day.',
            scheduleKind: 'daily' as const,
            defaultSection: 'morning' as const,
            items: ['Open curtains', 'Drink water', 'Check today'],
          },
          {
            id: STARTER_ROUTINE_IDS.evening,
            name: 'Evening reset',
            color: '#8C65B5',
            description: 'A short editable close to the day.',
            scheduleKind: 'daily' as const,
            defaultSection: 'evening' as const,
            items: ['Put away one thing', 'Prepare for tomorrow'],
          },
          {
            id: STARTER_ROUTINE_IDS.leaving,
            name: 'Leaving the house',
            color: '#3D9F98',
            description: 'A manual checklist for heading out.',
            scheduleKind: 'manual' as const,
            defaultSection: 'anyTime' as const,
            items: ['Keys', 'Phone', 'Wallet or bag'],
          },
        ];
        for (const [order, definition] of definitions.entries()) {
          const record: RoutineRecord = {
            id: definition.id,
            name: definition.name,
            color: definition.color,
            description: definition.description,
            isActive: true,
            presentationStyle: 'checklist',
            scheduleKind: definition.scheduleKind,
            selectedWeekdays: [],
            defaultSection: definition.defaultSection,
            order,
            createdAt: now,
            modifiedAt: now,
          };
          if (!(await this.db.routines.get(record.id))) {
            await this.db.routines.add(record);
            created.push(record);
            await this.db.routineItems.bulkAdd(
              definition.items.map((title, itemOrder) => ({
                id: `${STARTER_ITEM_PREFIXES[record.id]}${String(itemOrder + 1).padStart(12, '0')}`,
                routineId: record.id,
                title,
                order: itemOrder,
                isActive: true,
                createdAt: now,
                modifiedAt: now,
              })),
            );
          }
        }
        await this.db.metadata.put({
          key: 'routineStarterDataVersion',
          value: String(ROUTINE_STARTER_DATA_VERSION),
          updatedAt: now,
        });
      },
    );
    if (created.length) this.notify();
    return created;
  }

  public async saveRoutine(input: RoutineInput, id?: string): Promise<RoutineRecord> {
    validateInput(input);
    const now = this.now();
    const existing = id ? await this.db.routines.get(id) : undefined;
    if (id && (!existing || existing.deletedAt)) {
      throw new RoutineValidationError('Active routine not found.');
    }
    const routineId = existing?.id ?? this.createId();
    const routine: RoutineRecord = {
      id: routineId,
      name: input.name.trim(),
      color: input.color,
      description: cleanOptional(input.description),
      isActive: input.isActive,
      expectedDurationMinutes: input.expectedDurationMinutes,
      presentationStyle: input.presentationStyle,
      scheduleKind: input.scheduleKind,
      selectedWeekdays:
        input.scheduleKind === 'selected' ? [...new Set(input.selectedWeekdays)].sort() : [],
      defaultSection: input.defaultSection,
      order: existing?.order ?? (await this.db.routines.filter(active).count()),
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    const [suppliedItems, suppliedVariants] = await Promise.all([
      this.db.routineItems.bulkGet(input.items.map((item) => item.id)),
      this.db.routineVariants.bulkGet(input.variants.map((variant) => variant.id)),
    ]);
    if (suppliedItems.some((item) => item && item.routineId !== routineId)) {
      throw new RoutineValidationError('A routine item ID is already used by another routine.');
    }
    if (suppliedVariants.some((variant) => variant && variant.routineId !== routineId)) {
      throw new RoutineValidationError('A variant ID is already used by another routine.');
    }
    await this.db.transaction(
      'rw',
      [this.db.routines, this.db.routineItems, this.db.routineVariants],
      async () => {
        const currentItems = existing
          ? await this.db.routineItems.where('routineId').equals(routineId).toArray()
          : [];
        const currentVariants = existing
          ? await this.db.routineVariants.where('routineId').equals(routineId).toArray()
          : [];
        const suppliedItemIds = new Set(input.items.map((item) => item.id));
        const suppliedVariantIds = new Set(input.variants.map((variant) => variant.id));
        const deletionGroupId = this.createId();
        await this.db.routines.put(routine);
        await this.db.routineItems.bulkPut(
          input.items.map((item, order): RoutineItemRecord => {
            const current = currentItems.find((candidate) => candidate.id === item.id);
            return {
              id: item.id,
              routineId,
              title: item.title.trim(),
              estimatedDurationMinutes: item.estimatedDurationMinutes,
              note: cleanOptional(item.note),
              order,
              isActive: item.isActive,
              createdAt: current?.createdAt ?? now,
              modifiedAt: now,
            };
          }),
        );
        await Promise.all(
          currentItems
            .filter((item) => active(item) && !suppliedItemIds.has(item.id))
            .map((item) =>
              this.db.routineItems.update(item.id, {
                deletedAt: now,
                deletionGroupId,
                modifiedAt: now,
              }),
            ),
        );
        if (input.variants.length) {
          await this.db.routineVariants.bulkPut(
            input.variants.map((variant, order): RoutineVariantRecord => {
              const current = currentVariants.find((candidate) => candidate.id === variant.id);
              return {
                id: variant.id,
                routineId,
                name: variant.name.trim(),
                weekdays: [...new Set(variant.weekdays)].sort(),
                itemIds: [...variant.itemIds],
                presentationStyle: variant.presentationStyle,
                order,
                createdAt: current?.createdAt ?? now,
                modifiedAt: now,
              };
            }),
          );
        }
        await Promise.all(
          currentVariants
            .filter((variant) => active(variant) && !suppliedVariantIds.has(variant.id))
            .map((variant) =>
              this.db.routineVariants.update(variant.id, {
                deletedAt: now,
                deletionGroupId,
                modifiedAt: now,
              }),
            ),
        );
      },
    );
    this.notify();
    return routine;
  }

  public async duplicateRoutine(id: string): Promise<RoutineRecord> {
    const routine = await this.requireActiveRoutine(id);
    const items = (await this.db.routineItems.where('routineId').equals(id).toArray())
      .filter(active)
      .sort((left, right) => left.order - right.order);
    const variants = (await this.db.routineVariants.where('routineId').equals(id).toArray())
      .filter(active)
      .sort((left, right) => left.order - right.order);
    const mappedItemIds = new Map(items.map((item) => [item.id, this.createId()]));
    return this.saveRoutine({
      ...routine,
      name: `${routine.name} copy`,
      items: items.map((item) => ({ ...item, id: mappedItemIds.get(item.id)! })),
      variants: variants.map((variant) => ({
        ...variant,
        id: this.createId(),
        itemIds: variant.itemIds.flatMap((itemId) => {
          const mapped = mappedItemIds.get(itemId);
          return mapped ? [mapped] : [];
        }),
      })),
    });
  }

  public async moveRoutine(id: string, direction: -1 | 1): Promise<void> {
    const routines = (await this.db.routines.toArray())
      .filter(active)
      .sort((a, b) => a.order - b.order);
    const index = routines.findIndex((routine) => routine.id === id);
    const other = routines[index + direction];
    if (index < 0 || !other) return;
    const now = this.now();
    await this.db.transaction('rw', this.db.routines, async () => {
      await this.db.routines.update(id, { order: other.order, modifiedAt: now });
      await this.db.routines.update(other.id, { order: routines[index]!.order, modifiedAt: now });
    });
    this.notify();
  }

  public async setRoutineActive(id: string, isActive: boolean): Promise<void> {
    await this.requireActiveRoutine(id);
    await this.db.routines.update(id, { isActive, modifiedAt: this.now() });
    this.notify();
  }

  public async deleteRoutine(id: string): Promise<DeletionReceipt> {
    const routine = await this.requireActiveRoutine(id);
    const now = this.now();
    const groupId = this.createId();
    await this.db.transaction(
      'rw',
      [this.db.routines, this.db.routineItems, this.db.routineVariants],
      async () => {
        await this.db.routines.update(id, {
          deletedAt: now,
          deletionGroupId: groupId,
          modifiedAt: now,
        });
        await this.db.routineItems
          .where('routineId')
          .equals(id)
          .filter(active)
          .modify({ deletedAt: now, deletionGroupId: groupId, modifiedAt: now });
        await this.db.routineVariants
          .where('routineId')
          .equals(id)
          .filter(active)
          .modify({ deletedAt: now, deletionGroupId: groupId, modifiedAt: now });
      },
    );
    this.notify();
    return { groupId, kind: 'routine', entityId: id, label: routine.name, deletedAt: now };
  }

  public async restoreDeletionGroup(groupId: string): Promise<void> {
    const [routines, items, variants] = await Promise.all([
      this.db.routines.where('deletionGroupId').equals(groupId).toArray(),
      this.db.routineItems.where('deletionGroupId').equals(groupId).toArray(),
      this.db.routineVariants.where('deletionGroupId').equals(groupId).toArray(),
    ]);
    if (!routines.length && !items.length)
      throw new RoutineValidationError('This deletion can no longer be undone.');
    const now = this.now();
    await this.db.transaction(
      'rw',
      [this.db.routines, this.db.routineItems, this.db.routineVariants],
      async () => {
        await Promise.all([
          ...routines.map((routine) =>
            this.db.routines.update(routine.id, {
              deletedAt: undefined,
              deletionGroupId: undefined,
              modifiedAt: now,
            }),
          ),
          ...items.map((item) =>
            this.db.routineItems.update(item.id, {
              deletedAt: undefined,
              deletionGroupId: undefined,
              modifiedAt: now,
            }),
          ),
          ...variants.map((variant) =>
            this.db.routineVariants.update(variant.id, {
              deletedAt: undefined,
              deletionGroupId: undefined,
              modifiedAt: now,
            }),
          ),
        ]);
      },
    );
    this.notify();
  }

  public async restoreRoutine(id: string): Promise<void> {
    const routine = await this.db.routines.get(id);
    if (!routine?.deletedAt) throw new RoutineValidationError('Deleted routine not found.');
    await this.restoreDeletionGroup(routine.deletionGroupId ?? '');
  }

  public async restoreItem(id: string, restoreRoutine = false): Promise<void> {
    const item = await this.db.routineItems.get(id);
    if (!item?.deletedAt) throw new RoutineValidationError('Deleted routine item not found.');
    const routine = await this.db.routines.get(item.routineId);
    if (routine?.deletedAt && !restoreRoutine) {
      throw new RoutineValidationError('Restore the parent routine first.');
    }
    if (routine?.deletedAt && restoreRoutine) {
      await this.restoreDeletionGroup(routine.deletionGroupId ?? '');
      return;
    }
    const now = this.now();
    await this.db.transaction('rw', this.db.routineItems, async () => {
      await this.db.routineItems.update(id, {
        deletedAt: undefined,
        deletionGroupId: undefined,
        modifiedAt: now,
      });
    });
    this.notify();
  }

  public async permanentlyDeleteRoutine(id: string): Promise<void> {
    const routine = await this.db.routines.get(id);
    if (!routine?.deletedAt) throw new RoutineValidationError('Deleted routine not found.');
    await this.db.transaction(
      'rw',
      [
        this.db.routines,
        this.db.routineItems,
        this.db.routineVariants,
        this.db.routineOccurrenceAdjustments,
      ],
      async () => {
        await this.db.routineItems.where('routineId').equals(id).delete();
        await this.db.routineVariants.where('routineId').equals(id).delete();
        await this.db.routineOccurrenceAdjustments.where('routineId').equals(id).delete();
        await this.db.routines.delete(id);
      },
    );
    this.notify();
  }

  public async permanentlyDeleteItem(id: string): Promise<void> {
    const item = await this.db.routineItems.get(id);
    if (!item?.deletedAt) throw new RoutineValidationError('Deleted routine item not found.');
    await this.db.transaction('rw', [this.db.routineItems, this.db.routineVariants], async () => {
      const variants = await this.db.routineVariants
        .where('routineId')
        .equals(item.routineId)
        .toArray();
      await Promise.all(
        variants.map((variant) =>
          this.db.routineVariants.update(variant.id, {
            itemIds: variant.itemIds.filter((candidate) => candidate !== id),
            modifiedAt: this.now(),
          }),
        ),
      );
      await this.db.routineItems.delete(id);
    });
    this.notify();
  }

  public async emptyRecentlyDeleted(): Promise<number> {
    const [routines, items] = await Promise.all([
      this.db.routines.filter((routine) => !active(routine)).toArray(),
      this.db.routineItems.filter((item) => !active(item)).toArray(),
    ]);
    for (const routine of routines) await this.permanentlyDeleteRoutine(routine.id);
    for (const item of items) {
      if (await this.db.routineItems.get(item.id)) await this.permanentlyDeleteItem(item.id);
    }
    return routines.length + items.length;
  }

  public async createOrResumeRun(
    routineId: string,
    localDate: string,
    style?: RoutinePresentationStyle,
  ): Promise<RoutineRunRecord> {
    if (!isLocalDate(localDate)) throw new RoutineValidationError('Choose a valid local date.');
    const existing = await this.db.routineRuns
      .where('[routineId+localDate]')
      .equals([routineId, localDate])
      .first();
    if (existing) return existing;
    const routine = await this.requireActiveRoutine(routineId);
    const variants = (
      await this.db.routineVariants.where('routineId').equals(routineId).toArray()
    ).filter(active);
    const variant = routineVariantForDate(routineId, variants, localDate);
    const items = routineItemsForDate(
      routine,
      await this.db.routineItems.where('routineId').equals(routineId).toArray(),
      variant,
    );
    if (!items.length)
      throw new RoutineValidationError('This routine has no active items for the selected date.');
    const now = this.now();
    const run: RoutineRunRecord = {
      id: this.createId(),
      routineId,
      routineName: routine.name,
      routineColor: routine.color,
      localDate,
      variantId: variant?.id,
      variantName: variant?.name,
      presentationStyle: style ?? variant?.presentationStyle ?? routine.presentationStyle,
      status: 'inProgress',
      startedAt: now,
      modifiedAt: now,
    };
    const runItems: RoutineRunItemRecord[] = items.map((item, order) => ({
      id: this.createId(),
      runId: run.id,
      sourceRoutineItemId: item.id,
      title: item.title,
      estimatedDurationMinutes: item.estimatedDurationMinutes,
      note: item.note,
      order,
      createdAt: now,
      modifiedAt: now,
    }));
    await this.db.transaction('rw', [this.db.routineRuns, this.db.routineRunItems], async () => {
      await this.db.routineRuns.add(run);
      await this.db.routineRunItems.bulkAdd(runItems);
    });
    this.notify();
    return run;
  }

  public async setRunStyle(id: string, style: RoutinePresentationStyle): Promise<void> {
    await this.requireRun(id);
    await this.db.routineRuns.update(id, { presentationStyle: style, modifiedAt: this.now() });
    this.notify();
  }

  public async setRunItemCompleted(id: string, completed: boolean): Promise<void> {
    const item = await this.db.routineRunItems.get(id);
    if (!item) throw new RoutineValidationError('Routine run item not found.');
    const run = await this.requireRun(item.runId);
    if (run.status !== 'inProgress')
      throw new RoutineValidationError('Reopen this routine run before changing items.');
    const now = this.now();
    await this.db.routineRunItems.update(id, {
      completedAt: completed ? now : undefined,
      modifiedAt: now,
    });
    if (completed && typeof navigator !== 'undefined' && 'vibrate' in navigator)
      navigator.vibrate?.(10);
    this.notify();
  }

  public async completeRun(id: string, confirmUnfinished = false): Promise<void> {
    const run = await this.requireRun(id);
    const items = await this.db.routineRunItems.where('runId').equals(id).toArray();
    if (items.some((item) => !item.completedAt) && !confirmUnfinished)
      throw new UnfinishedRoutineError();
    const now = this.now();
    await this.db.routineRuns.update(run.id, {
      status: 'completed',
      completedAt: now,
      skippedAt: undefined,
      skipReason: undefined,
      modifiedAt: now,
    });
    this.notify();
  }

  public async reopenRun(id: string): Promise<void> {
    const run = await this.requireRun(id);
    await this.db.routineRuns.update(run.id, {
      status: 'inProgress',
      completedAt: undefined,
      skippedAt: undefined,
      skipReason: undefined,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async skipRun(
    routineId: string,
    localDate: string,
    reason?: string,
  ): Promise<RoutineRunRecord> {
    const run = await this.createOrResumeRun(routineId, localDate);
    const now = this.now();
    await this.db.routineRuns.update(run.id, {
      status: 'skipped',
      completedAt: undefined,
      skippedAt: now,
      skipReason: cleanOptional(reason),
      modifiedAt: now,
    });
    this.notify();
    return (await this.db.routineRuns.get(run.id))!;
  }

  public async moveOccurrence(
    routineId: string,
    originalDate: string,
    destinationDate: string,
  ): Promise<RoutineOccurrenceAdjustmentRecord> {
    await this.requireActiveRoutine(routineId);
    if (
      !isLocalDate(originalDate) ||
      !isLocalDate(destinationDate) ||
      originalDate === destinationDate
    ) {
      throw new RoutineValidationError('Choose a different valid destination date.');
    }
    const existing = await this.db.routineOccurrenceAdjustments
      .where('[routineId+originalDate]')
      .equals([routineId, originalDate])
      .first();
    const now = this.now();
    const record: RoutineOccurrenceAdjustmentRecord = {
      id: existing?.id ?? this.createId(),
      routineId,
      originalDate,
      destinationDate,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    await this.db.routineOccurrenceAdjustments.put(record);
    this.notify();
    return record;
  }

  private async requireActiveRoutine(id: string): Promise<RoutineRecord> {
    const routine = await this.db.routines.get(id);
    if (!routine || routine.deletedAt)
      throw new RoutineValidationError('Active routine not found.');
    return routine;
  }

  private async requireRun(id: string): Promise<RoutineRunRecord> {
    const run = await this.db.routineRuns.get(id);
    if (!run) throw new RoutineValidationError('Routine run not found.');
    return run;
  }
}

export const routineRepository = new RoutineRepository();
