import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('app navigation', () => {
  it('switches sidebar pages immediately', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const navButtons = container.querySelectorAll<HTMLButtonElement>('.sidebar-nav .sidebar-link');
    expect(navButtons).toHaveLength(5);
    expect(navButtons[0]).toHaveAttribute('aria-current', 'page');

    await user.click(navButtons[1]);

    expect(navButtons[1]).toHaveAttribute('aria-current', 'page');
    expect(navButtons[0]).not.toHaveAttribute('aria-current');
  });
});
