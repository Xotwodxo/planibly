import { render, screen } from '@testing-library/react';

import { useHasUnsavedChanges, useUnsavedChanges } from './unsavedChanges';

function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  const hasUnsavedChanges = useHasUnsavedChanges();
  return <output>{hasUnsavedChanges ? 'Unsaved' : 'Saved'}</output>;
}

describe('unsaved change registry', () => {
  it('tracks dirty forms and clears them when the form is clean', () => {
    const view = render(<Harness dirty={false} />);
    expect(screen.getByText('Saved')).toBeVisible();
    view.rerender(<Harness dirty />);
    expect(screen.getByText('Unsaved')).toBeVisible();
    view.rerender(<Harness dirty={false} />);
    expect(screen.getByText('Saved')).toBeVisible();
  });
});
