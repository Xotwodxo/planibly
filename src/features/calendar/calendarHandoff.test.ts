import {
  CALENDAR_COPY_NOTICE,
  canShareIcsFile,
  createIcsFile,
  safeIcsFilename,
  shareIcsFile,
} from './calendarHandoff';

describe('calendar file handoff', () => {
  it('creates a local text/calendar file with a safe name', () => {
    const file = createIcsFile('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'My / diary.ics');
    expect(file.name).toBe('My-diary.ics');
    expect(file.type).toBe('text/calendar;charset=utf-8');
    expect(safeIcsFilename('***')).toBe('planibly-calendar.ics');
  });

  it('detects file sharing only when the browser explicitly accepts the file', () => {
    const unsupported = {} as Navigator;
    const supported = {
      share: vi.fn().mockResolvedValue(undefined),
      canShare: vi.fn().mockReturnValue(true),
    } as unknown as Navigator;
    expect(canShareIcsFile(unsupported)).toBe(false);
    expect(canShareIcsFile(supported)).toBe(true);
  });

  it('gives a download-fallback instruction when file sharing is unavailable', async () => {
    await expect(
      shareIcsFile('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'calendar.ics', {} as Navigator),
    ).rejects.toThrow('Use Download ICS instead');
    expect(CALENDAR_COPY_NOTICE).toContain('will not sync automatically');
  });
});
