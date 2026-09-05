import { describe, expect, it } from 'vitest';

import { toAuthUserMessage } from './workspaceIdentity';

describe('toAuthUserMessage', () => {
  it('translates failed to fetch into Chinese guidance', () => {
    expect(toAuthUserMessage(new Error('Failed to fetch'))).toContain('无法连接服务器');
  });

  it('keeps already Chinese messages', () => {
    expect(toAuthUserMessage(new Error('用户名或密码不正确，请检查后重试'))).toBe(
      '用户名或密码不正确，请检查后重试',
    );
  });

  it('translates connection refused', () => {
    expect(toAuthUserMessage(new Error('connect ECONNREFUSED 127.0.0.1:8787'))).toContain('连不上后端');
  });
});
