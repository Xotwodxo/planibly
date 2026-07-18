export const CALENDAR_COPY_NOTICE =
  'This creates a copy in the other calendar. Later changes will not sync automatically.';

export function createIcsFile(contents: string, filename: string): File {
  return new File([contents], safeIcsFilename(filename), { type: 'text/calendar;charset=utf-8' });
}

export function canShareIcsFile(navigatorObject: Navigator = navigator): boolean {
  if (
    typeof navigatorObject.share !== 'function' ||
    typeof navigatorObject.canShare !== 'function'
  ) {
    return false;
  }
  try {
    return navigatorObject.canShare({
      files: [createIcsFile('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'calendar.ics')],
    });
  } catch {
    return false;
  }
}

export async function shareIcsFile(
  contents: string,
  filename: string,
  navigatorObject: Navigator = navigator,
): Promise<void> {
  const file = createIcsFile(contents, filename);
  if (
    typeof navigatorObject.share !== 'function' ||
    typeof navigatorObject.canShare !== 'function' ||
    !navigatorObject.canShare({ files: [file] })
  ) {
    throw new Error('File sharing is not supported in this browser. Use Download ICS instead.');
  }
  await navigatorObject.share({ files: [file], title: 'Planibly calendar export' });
}

export function downloadIcsFile(contents: string, filename: string): void {
  const blob = new Blob([contents], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeIcsFilename(filename);
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeIcsFilename(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const base = cleaned.replace(/\.ics$/i, '') || 'planibly-calendar';
  return `${base.slice(0, 80)}.ics`;
}
