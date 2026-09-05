import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
  confirmPasswordReset,
  requestPasswordReset,
  toAuthUserMessage,
} from '../utils/workspaceIdentity';

function PasswordResetPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const initialToken = params.get('token')?.trim() || '';

  const [step, setStep] = useState<'request' | 'confirm'>(initialToken ? 'confirm' : 'request');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devToken, setDevToken] = useState('');

  const title = useMemo(() => (step === 'request' ? '找回密码' : '设置新密码'), [step]);

  const onRequest = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setDevToken('');
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    setLoading(true);
    try {
      const result = await requestPasswordReset(apiBaseUrl, username.trim());
      setMessage(result.message || '如果账号存在，重置指令已生成。');
      if (result.resetToken) {
        setDevToken(result.resetToken);
        setToken(result.resetToken);
        setStep('confirm');
      }
    } catch (submitError) {
      setError(toAuthUserMessage(submitError, '申请重置失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const onConfirm = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!token.trim()) {
      setError('请填写重置令牌');
      return;
    }
    if (password.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (password !== password2) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const result = await confirmPasswordReset(apiBaseUrl, token.trim(), password);
      setMessage(result.message || '密码已更新，请使用新密码登录');
      window.setTimeout(() => navigate('/login', { replace: true }), 900);
    } catch (submitError) {
      setError(toAuthUserMessage(submitError, '重置密码失败，请检查链接是否过期'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cc-login">
      <div className="cc-login-grid" aria-hidden="true" />
      <div className="cc-login-frame">
        <section className="cc-auth" style={{ gridColumn: '1 / -1', maxWidth: 520, margin: '0 auto' }}>
          <div className="cc-auth-panel">
            <div className="cc-auth-head">
              <p className="cc-auth-badge">PASSWORD RESET</p>
              <h2>{title}</h2>
              <p>
                {step === 'request'
                  ? '输入用户名后申请重置。生产环境会通过通知渠道发送令牌；本地开发可能直接显示令牌。'
                  : '粘贴重置令牌并设置新密码。'}
              </p>
            </div>

            {step === 'request' ? (
              <form className="cc-auth-form" onSubmit={onRequest}>
                <label className="field-label" htmlFor="reset-username">
                  用户名
                  <input
                    id="reset-username"
                    className="text-input"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="请输入用户名"
                  />
                </label>
                {error ? <p className="status-note status-note-danger">{error}</p> : null}
                {message ? <p className="status-note status-note-success">{message}</p> : null}
                {devToken ? (
                  <p className="status-note">
                    开发模式令牌已生成，可直接进入设置新密码。
                  </p>
                ) : null}
                <div className="actions-row">
                  <button className="action-button" type="submit" disabled={loading}>
                    {loading ? '提交中…' : '申请重置'}
                  </button>
                  <button className="action-button secondary-button" type="button" onClick={() => setStep('confirm')}>
                    我已有令牌
                  </button>
                  <Link className="action-button secondary-button" to="/login">
                    返回登录
                  </Link>
                </div>
              </form>
            ) : (
              <form className="cc-auth-form" onSubmit={onConfirm}>
                <label className="field-label" htmlFor="reset-token">
                  重置令牌
                  <input
                    id="reset-token"
                    className="text-input"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="粘贴重置令牌"
                  />
                </label>
                <label className="field-label" htmlFor="reset-password">
                  新密码
                  <input
                    id="reset-password"
                    className="text-input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="至少 8 位"
                  />
                </label>
                <label className="field-label" htmlFor="reset-password2">
                  确认新密码
                  <input
                    id="reset-password2"
                    className="text-input"
                    type="password"
                    value={password2}
                    onChange={(event) => setPassword2(event.target.value)}
                    autoComplete="new-password"
                    placeholder="再输入一次"
                  />
                </label>
                {error ? <p className="status-note status-note-danger">{error}</p> : null}
                {message ? <p className="status-note status-note-success">{message}</p> : null}
                <div className="actions-row">
                  <button className="action-button" type="submit" disabled={loading}>
                    {loading ? '提交中…' : '确认重置'}
                  </button>
                  <button className="action-button secondary-button" type="button" onClick={() => setStep('request')}>
                    返回申请
                  </button>
                  <Link className="action-button secondary-button" to="/login">
                    返回登录
                  </Link>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default PasswordResetPage;
