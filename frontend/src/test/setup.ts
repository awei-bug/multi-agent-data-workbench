import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.stubEnv('VITE_WORKSPACE_API_BASE_URL', '');

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }),
}));
