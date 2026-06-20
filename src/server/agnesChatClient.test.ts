import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgnesChatClient } from './agnesChatClient';

describe('agnes chat client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends OpenAI-compatible chat completions to the configured Agnes endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '分析摘要',
            },
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = createAgnesChatClient({
      apiKey: 'test-key',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      model: 'Agnes 2.0 Flash',
    });

    const content = await client.complete('请总结销售趋势');

    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: JSON.stringify({
        model: 'Agnes 2.0 Flash',
        messages: [{ role: 'user', content: '请总结销售趋势' }],
      }),
    });
    expect(content).toBe('分析摘要');
  });
});
