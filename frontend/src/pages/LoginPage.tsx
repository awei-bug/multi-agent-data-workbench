import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createEmptyTask } from './emptyTask';
import type { TaskRecord } from '../types/tasks';
import { resolveContinuePath } from '../utils/continuePlan';
import {
  loginWithPassword,
  registerWithPassword,
  workspaceFetch,
} from '../utils/workspaceIdentity';

type Mode = 'login' | 'register';

type LoginPageProps = {
  onAuthenticated?: () => void;
};

const PIPELINE = [
  { id: 'src', label: '数据接入', status: 'online' },
  { id: 'clean', label: '清洗治理', status: 'online' },
  { id: 'metric', label: '指标计算', status: 'active' },
  { id: 'chart', label: '可视化', status: 'standby' },
  { id: 'report', label: '报告交付', status: 'standby' },
];

const SIGNALS = [
  { label: 'Agent 节点', value: '07', unit: 'ACTIVE' },
  { label: '权限模型', value: 'RBAC', unit: '3 ROLES' },
  { label: '作用域', value: 'JWT', unit: 'BOUND' },
];

function LoginPage({ onAuthenticated }: LoginPageProps) {
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('local-tenant');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const title = mode === 'login' ? '接入分析指挥台' : '初始化团队账号';
  const subtitle =
    mode === 'login'
      ? '验证身份后进入多租户隔离工作区，继续当前分析任务。'
      : '首个账号自动授予 admin，后续成员可按 viewer / analyst 协作。';
  const submitLabel = loading
    ? mode === 'login'
      ? '身份校验中…'
      : '账号创建中…'
    : mode === 'login'
      ? '进入指挥台'
      : '创建并进入';

  const switchHint = useMemo(
    () => (mode === 'login' ? '没有账号？初始化团队' : '已有账号？返回登录'),
    [mode],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await loginWithPassword(apiBaseUrl, username, password);
      } else {
        await registerWithPassword(apiBaseUrl, {
          username,
          password,
          tenantId,
          displayName: displayName || username,
        });
      }
      onAuthenticated?.();

      // Jump to the page for "what to do next" based on current task state.
      let nextPath = '/dashboard';
      try {
        const response = await workspaceFetch(`${apiBaseUrl}/api/tasks/active`);
        const task = (response.ok ? await response.json() : createEmptyTask()) as TaskRecord;
        nextPath = resolveContinuePath(task, '/dashboard');
      } catch {
        nextPath = '/dashboard';
      }
      navigate(nextPath, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '认证失败');
    } finally {
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
                <strong>多 Agent 数据分析工作台</strong>
                <em>COMMAND ANALYTICS DECK</em>
              </div>
            </div>
            <div className="cc-status-chip">
              <span className="cc-pulse" />
              SYSTEMS NOMINAL
            </div>
          </header>

          <div className="cc-command-main">
            <p className="cc-kicker cc-enter cc-enter-2">OPERATIONS · MULTI-AGENT · DELIVERY</p>
            <h1 className="cc-enter cc-enter-3">
              把数据接入、协同分析
              <br />
              与报告交付收束到
              <br />
              <span>同一指挥台</span>
            </h1>
            <p className="cc-lead cc-enter cc-enter-4">
              面向经营复盘、异常排查与管理汇报。登录后按角色协作，从原始数据推进到可交付结论。
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
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={8}
                />
              </label>

              {mode === 'register' ? (
                <div className="cc-field-row cc-register-in">
                  <label className="cc-field">
                    <span>租户 ID</span>
                    <input
                      value={tenantId}
                      onChange={(event) => setTenantId(event.target.value)}
                      placeholder="local-tenant"
                    />
                  </label>
                  <label className="cc-field">
                    <span>显示名称</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="可选"
                    />
                  </label>
                </div>
              ) : null}

              {error ? <p className="cc-error">{error}</p> : null}

              <button className={`cc-submit${loading ? ' is-loading' : ''}`} type="submit" disabled={loading}>
                <span className="cc-submit-glow" aria-hidden="true" />
                {loading ? <span className="cc-spinner" aria-hidden="true" /> : null}
                <span>{submitLabel}</span>
                {!loading ? <em>→</em> : null}
              </button>

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
                <strong>作用域</strong>
                <span>JWT 绑定租户/用户</span>
              </div>
              <div>
                <strong>隔离</strong>
                <span>租户级数据边界</span>
              </div>
              <div>
                <strong>交付</strong>
                <span>报告导出与审计</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default LoginPage;
