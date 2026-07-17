import type { RecurrenceDefinition, RecurrenceFrequency } from '../../data/plannerTypes';
import { recurrenceSummary } from '../../data/recurrence';

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function defaultRecurrenceForDate(localDate: string): RecurrenceDefinition {
  return {
    frequency: 'daily',
    interval: 1,
    endMode: 'never',
    ...patternFields('daily', localDate),
  };
}

function recurrenceForFrequency(
  current: RecurrenceDefinition,
  frequency: RecurrenceFrequency,
  localDate: string,
): RecurrenceDefinition {
  return { ...current, frequency, ...patternFields(frequency, localDate) };
}

export function RecurrenceFields({
  value,
  startDate,
  onChange,
}: {
  value?: RecurrenceDefinition;
  startDate: string;
  onChange: (value: RecurrenceDefinition | undefined) => void;
}) {
  const definition = value ?? defaultRecurrenceForDate(startDate);
  return (
    <details className="optional-section recurrence-fields">
      <summary>
        Repeat
        {value ? <span className="field-help"> · {recurrenceSummary(value)}</span> : null}
      </summary>
      <div className="editor-form">
        <label className="check-field">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked ? definition : undefined)}
          />
          <span>Repeat this event</span>
        </label>
        {value ? (
          <fieldset className="recurrence-fields__options">
            <legend className="visually-hidden">Repeat pattern</legend>
            <label className="field">
              <span>Pattern</span>
              <select
                value={value.frequency}
                onChange={(event) =>
                  onChange(
                    recurrenceForFrequency(
                      value,
                      event.target.value as RecurrenceFrequency,
                      startDate,
                    ),
                  )
                }
              >
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays only</option>
                <option value="weekly">Weekly on selected days</option>
                <option value="monthlyDay">Monthly on a day</option>
                <option value="monthlyOrdinal">Monthly on an ordinal weekday</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className="field">
              <span>Repeat every</span>
              <span className="inline-number-field">
                <input
                  aria-label="Repeat interval"
                  type="number"
                  min={1}
                  max={999}
                  value={value.interval}
                  onChange={(event) => onChange({ ...value, interval: Number(event.target.value) })}
                />
                <span>{intervalUnit(value.frequency)}</span>
              </span>
            </label>
            {value.frequency === 'weekly' ? (
              <fieldset className="weekday-choices">
                <legend>Repeat on</legend>
                {WEEKDAYS.map((weekday) => (
                  <label key={weekday.value} className="check-field">
                    <input
                      type="checkbox"
                      checked={(value.weekdays ?? []).includes(weekday.value)}
                      onChange={(event) => {
                        const days = new Set(value.weekdays ?? []);
                        if (event.target.checked) days.add(weekday.value);
                        else days.delete(weekday.value);
                        onChange({ ...value, weekdays: [...days].sort((a, b) => a - b) });
                      }}
                    />
                    <span>{weekday.label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {value.frequency === 'monthlyDay' ? (
              <label className="field">
                <span>Day of month</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={value.monthDay ?? 1}
                  onChange={(event) => onChange({ ...value, monthDay: Number(event.target.value) })}
                />
                <small>Months without this date are skipped.</small>
              </label>
            ) : null}
            {value.frequency === 'monthlyOrdinal' ? (
              <div className="event-editor__dates">
                <label className="field">
                  <span>Occurrence</span>
                  <select
                    value={value.ordinal ?? 1}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        ordinal: Number(event.target.value) as 1 | 2 | 3 | 4 | -1,
                      })
                    }
                  >
                    <option value={1}>First</option>
                    <option value={2}>Second</option>
                    <option value={3}>Third</option>
                    <option value={4}>Fourth</option>
                    <option value={-1}>Last</option>
                  </select>
                </label>
                <label className="field">
                  <span>Weekday</span>
                  <select
                    value={value.ordinalWeekday ?? 1}
                    onChange={(event) =>
                      onChange({ ...value, ordinalWeekday: Number(event.target.value) })
                    }
                  >
                    {WEEKDAYS.map((weekday) => (
                      <option key={weekday.value} value={weekday.value}>
                        {weekday.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {value.frequency === 'yearly' ? (
              <div className="event-editor__dates">
                <label className="field">
                  <span>Month</span>
                  <select
                    value={value.yearlyMonth ?? 1}
                    onChange={(event) =>
                      onChange({ ...value, yearlyMonth: Number(event.target.value) })
                    }
                  >
                    {Array.from({ length: 12 }, (_, index) => (
                      <option key={index + 1} value={index + 1}>
                        {new Intl.DateTimeFormat(undefined, {
                          month: 'long',
                          timeZone: 'UTC',
                        }).format(new Date(Date.UTC(2024, index, 1)))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Day</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={value.yearlyDay ?? 1}
                    onChange={(event) =>
                      onChange({ ...value, yearlyDay: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            ) : null}
            <label className="field">
              <span>Ends</span>
              <select
                value={value.endMode}
                onChange={(event) => {
                  const endMode = event.target.value as RecurrenceDefinition['endMode'];
                  onChange({
                    ...value,
                    endMode,
                    endDate: endMode === 'until' ? (value.endDate ?? startDate) : undefined,
                    occurrenceCount:
                      endMode === 'count' ? (value.occurrenceCount ?? 10) : undefined,
                  });
                }}
              >
                <option value="never">Never</option>
                <option value="until">On a date</option>
                <option value="count">After a number of occurrences</option>
              </select>
            </label>
            {value.endMode === 'until' ? (
              <label className="field">
                <span>Last occurrence date</span>
                <input
                  type="date"
                  min={startDate}
                  value={value.endDate ?? startDate}
                  onChange={(event) => onChange({ ...value, endDate: event.target.value })}
                />
              </label>
            ) : null}
            {value.endMode === 'count' ? (
              <label className="field">
                <span>Number of occurrences</span>
                <input
                  type="number"
                  min={1}
                  max={10_000}
                  value={value.occurrenceCount ?? 10}
                  onChange={(event) =>
                    onChange({ ...value, occurrenceCount: Number(event.target.value) })
                  }
                />
              </label>
            ) : null}
            <p className="field-help" aria-live="polite">
              {recurrenceSummary(value)}
            </p>
          </fieldset>
        ) : null}
      </div>
    </details>
  );
}

function patternFields(frequency: RecurrenceFrequency, localDate: string) {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  switch (frequency) {
    case 'weekly':
      return { weekdays: [weekday] };
    case 'monthlyDay':
      return { monthDay: day };
    case 'monthlyOrdinal':
      return {
        ordinal: (day + 7 > lastDay ? -1 : Math.ceil(day / 7)) as 1 | 2 | 3 | 4 | -1,
        ordinalWeekday: weekday,
      };
    case 'yearly':
      return { yearlyMonth: month, yearlyDay: day };
    default:
      return {};
  }
}

function intervalUnit(frequency: RecurrenceFrequency): string {
  if (frequency === 'daily') return 'day(s)';
  if (frequency === 'weekly' || frequency === 'weekdays') return 'week(s)';
  if (frequency === 'monthlyDay' || frequency === 'monthlyOrdinal') return 'month(s)';
  return 'year(s)';
}
