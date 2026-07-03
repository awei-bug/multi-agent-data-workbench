import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '../../App';

describe('workspace shell flow', () => {
  it('keeps the sidebar active state in sync with direct clicks', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    const navButtons = container.querySelectorAll<HTMLButtonElement>('.sidebar-nav .sidebar-link');

    await user.click(navButtons[4]);

    expect(navButtons[4]).toHaveAttribute('aria-current', 'page');
  });
});
