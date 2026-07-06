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
    expect(navButtons).toHaveLength(7);
    expect(navButtons[1]).toHaveAttribute('aria-current', 'page');

    await user.click(navButtons[4]);

    expect(navButtons[4]).toHaveAttribute('aria-current', 'page');
    expect(navButtons[1]).not.toHaveAttribute('aria-current');
    expect(container).not.toHaveTextContent('模板库');
    expect(container).not.toHaveTextContent('历史会话');
    expect(container).not.toHaveTextContent('异步沙箱');
  });
});
