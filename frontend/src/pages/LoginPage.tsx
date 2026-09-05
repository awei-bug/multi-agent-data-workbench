import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { createEmptyTask } from './emptyTask';
import type { TaskRecord } from '../types/tasks';
import { resolveContinuePath } from '../utils/continuePlan';
import {
  loginWithPassword,
  registerWithPassword,
  saveAuthSession,
  toAuthUserMessage,
  workspaceFetch,
} from '../utils/workspaceIdentity';

type Mode = 'login' | 'register';

type LoginPageProps = {
  onAuthenticated?: () => void;
};

const PIPELINE = [
  { id: 'src', label: '上传数据', status: 'online' },
  { id: 'clean', label: '整理数据', status: 'online' },
  { id: 'metric', label: '计算分析', status: 'active' },
  { id: 'chart', label: '生成图表', status: 'standby' },
  { id: 'report', label: '查看结果', status: 'standby' },
];

const SIGNALS = [
  { label: '分析步骤', value: '04', unit: '简易' },
  { label: '权限', value: '安全', unit: '账号隐私' },
  { label: '数据', value: '私有', unit: '仅自己可见' },
];

function LoginPage({ onAuthenticated }: LoginPageProps) {
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvancedRegister, setShowAdvancedRegister] = useState(false);
  const [tenantId, setTenantId] = useState('local-tenant');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcIssuer, setOidcIssuer] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBaseUrl}/api/auth/oidc/status`)
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((payload: { enabled?: boolean; issuer?: string }) => {
        if (cancelled) return;
        setOidcEnabled(Boolean(payload.enabled));
        setOidcIssuer(String(payload.issuer || ''));
      })
      .catch(() => {
        if (!cancelled) setOidcEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  // OIDC callback landing: /login?oidc=1&accessToken=... or handled by backend redirect payload stored in hash/query
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('accessToken');
    const oidcFlag = params.get('oidc');
    if (!token || oidcFlag !== '1') return;
    // Backend callback returns JSON; for browser SSO we also support token in query after frontend bridge.
    void (async () => {
      try {
        const me = await fetch(`${apiBaseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!me.ok) return;
        const payload = await me.json();
        saveAuthSession({ accessToken: token, user: payload.user });
        onAuthenticated?.();
        navigate('/dashboard', { replace: true });
      } catch {
        // ignore
      }
    })();
  }, [apiBaseUrl, navigate, onAuthenticated]);

  const title = mode === 'login' ? '登录后开始分析' : '创建账号';
  const subtitle =
    mode === 'login'
      ? '登录后可上传数据、提出问题，并自动生成分析结果。'
      : '创建后即可开始使用。第一个账号会成为管理员。';
  const submitLabel = loading
    ? mode === 'login'
      ? '正在登录…'
      : '正在创建…'
    : mode === 'login'
      ? '登录'
      : '创建并开始';

  const switchHint = useMemo(
    () => (mode === 'login' ? '没有账号？去注册' : '已有账号？返回登录'),
    [mode],
  );

  const finishLogin = async () => {
    onAuthenticated?.();
    let nextPath = '/dashboard';
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/tasks/active`);
      const task = (response.ok ? await response.json() : createEmptyTask()) as TaskRecord;
      nextPath = resolveContinuePath(task, '/dashboard');
    } catch {
      nextPath = '/dashboard';
    }
    navigate(nextPath, { replace: true });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setError('请输入用户名');
        return;
      }
      if (trimmedUsername.length < 3 || trimmedUsername.length > 64) {
        setError('用户名长度需在 3～64 位之间');
        return;
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedUsername)) {
        setError('用户名只能包含字母、数字、下划线 _、点 . 或短横线 -');
        return;
      }
      if (!password) {
        setError('请输入密码');
        return;
      }
      if (password.length < 8) {
        setError('密码至少需要 8 位');
        return;
      }

      if (mode === 'login') {
        await loginWithPassword(apiBaseUrl, trimmedUsername, password);
      } else {
        await registerWithPassword(apiBaseUrl, {
          username: trimmedUsername,
          password,
          tenantId,
          displayName: displayName || trimmedUsername,
        });
      }
      await finishLogin();
    } catch (submitError) {
      setError(
        toAuthUserMessage(
          submitError,
          mode === 'login' ? '登录失败，请稍后重试' : '注册失败，请稍后重试',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const onOidcLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/oidc/login`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error((typeof payload?.detail === 'string' ? payload.detail : payload?.error?.message) || '企业登录未启用或暂不可用');
      }
      const payload = await response.json();
      if (!payload.authorizeUrl) throw new Error('企业登录配置异常：未返回授权地址');
      // Full-page redirect to IdP.
      window.location.assign(String(payload.authorizeUrl));
    } catch (submitError) {
      setError(toAuthUserMessage(submitError, '企业登录失败，请稍后重试'));
      setLoading(false);
    }
  };

  return (
    <div className="cc-login">
      <div className="cc-login-grid" aria-hidden="true" />
      <div className="cc-login-glow cc-login-glow-a" aria-hidden="true" />
      <div className="cc-login-glow cc-login-glow-b" aria-hidden="true" />

      <div className="cc-login-frame">
        <section className="cc-command">
          <header className="cc-command-top cc-enter cc-enter-1">
            <div className="cc-brand">
              <span className="cc-brand-mark">
                <i />
                MA
              </span>
              <div>
                <strong>数据分析助手</strong>
                <em>上传 · 提问 · 看结果</em>
              </div>
            </div>
            <div className="cc-status-chip">
              <span className="cc-pulse" />
              SYSTEMS NOMINAL
            </div>
          </header>

          <div className="cc-command-main">
            <p className="cc-kicker cc-enter cc-enter-2">简单三步完成分析</p>
            <h1 className="cc-enter cc-enter-3">
              上传数据
              <br />
              提出问题
              <br />
              <span>自动出结论</span>
            </h1>
            <p className="cc-lead cc-enter cc-enter-4">
              不用写公式。把表格传上来，用一句话说你想分析什么，系统帮你整理结论和图表。
            </p>

            <div className="cc-signal-row cc-enter cc-enter-5">
              {SIGNALS.map((item) => (
                <article key={item.label} className="cc-signal">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <em>{item.unit}</em>
                </article>
              ))}
            </div>

            <div className="cc-pipeline cc-enter cc-enter-6">
              <div className="cc-pipeline-head">
                <span>AGENT PIPELINE</span>
                <span>LIVE TRACE</span>
              </div>
              <div className="cc-pipeline-track">
                {PIPELINE.map((node, index) => (
                  <div key={node.id} className={`cc-node cc-node-${node.status}`}>
                    <div className="cc-node-core">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <strong>{node.label}</strong>
                    {index < PIPELINE.length - 1 ? <i className="cc-node-link" /> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <footer className="cc-command-foot cc-enter cc-enter-7">
            <span>首个注册账号 → admin</span>
            <i />
            <span>viewer / analyst / admin</span>
            <i />
            <span>async workflow · audit trail</span>
          </footer>
        </section>

        <section className="cc-auth">
          <div className="cc-auth-panel cc-enter cc-enter-console">
            <div className="cc-auth-tabs" role="tablist" aria-label="登录或注册">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                注册
              </button>
            </div>

            <div className="cc-auth-head">
              <p className="cc-auth-badge">SECURE ACCESS</p>
              <h2 key={`t-${mode}`}>{title}</h2>
              <p key={`s-${mode}`}>{subtitle}</p>
            </div>

            <form className="cc-auth-form" onSubmit={onSubmit}>
              <label className="cc-field">
                <span>用户名</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="例如：analyst-a"
                  autoComplete="username"
                  required
                />
              </label>

              <label className="cc-field">
                <span>密码</span>
                <div className="cc-password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 8 位"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="cc-password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPassword}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? '隐藏' : '显示'}
                  </button>
                </div>
              </label>

              {mode === 'register' ? (
                <div className="cc-register-in">
                  <button
                    type="button"
                    className="cc-switch"
                    onClick={() => setShowAdvancedRegister((v) => !v)}
                  >
                    {showAdvancedRegister ? '收起高级选项' : '高级选项（一般不用改）'}
                  </button>
                  {showAdvancedRegister ? (
                    <div className="cc-field-row" style={{ marginTop: 12 }}>
                      <label className="cc-field">
                        <span>团队标识</span>
                        <input
                          value={tenantId}
                          onChange={(event) => setTenantId(event.target.value)}
                          placeholder="默认 local-tenant"
                        />
                      </label>
                      <label className="cc-field">
                        <span>显示名称</span>
                        <input
                          value={displayName}
                          onChange={(event) => setDisplayName(event.target.value)}
                          placeholder="可选，例如你的名字"
                        />
                      </label>
                    </div>
                  ) : null}
                  <p className="status-note" style={{ margin: '8px 0 0', color: 'rgba(170,200,225,0.72)', fontSize: 12 }}>
                    团队标识用于区分不同团队数据，个人使用保持默认即可。
                  </p>
                </div>
              ) : null}

              {error ? <p className="cc-error">{error}</p> : null}

              <button className={`cc-submit${loading ? ' is-loading' : ''}`} type="submit" disabled={loading}>
                <span className="cc-submit-glow" aria-hidden="true" />
                {loading ? <span className="cc-spinner" aria-hidden="true" /> : null}
                <span>{submitLabel}</span>
                {!loading ? <em>→</em> : null}
              </button>

              {mode === 'login' && oidcEnabled ? (
                <button className="cc-switch" type="button" disabled={loading} onClick={() => void onOidcLogin()}>
                  企业 SSO 登录{oidcIssuer ? `（${oidcIssuer}）` : ''}
                </button>
              ) : null}

              {mode === 'login' ? (
                <Link className="cc-switch" to="/reset-password">
                  忘记密码？去重置
                </Link>
              ) : null}

              <button
                className="cc-switch"
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setError('');
                }}
              >
                {switchHint}
              </button>
            </form>

            <div className="cc-auth-meta">
              <div>
                <strong>安全</strong>
                <span>账号安全登录</span>
              </div>
              <div>
                <strong>隐私</strong>
                <span>数据互相隐私</span>
              </div>
              <div>
                <strong>导出</strong>
                <span>结果可导出</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default LoginPage;
