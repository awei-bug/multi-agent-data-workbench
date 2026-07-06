import { useState } from 'react';

function SettingsPage() {
  const [tab, setTab] = useState<'model' | 'database' | 'security' | 'notice'>('model');
  const [editingSecret, setEditingSecret] = useState(false);
  const checks = ['模型网关已配置', 'PostgreSQL 已连接', '安全响应头已启用', '审计日志已留存'];

  return (
    <div className="workspace-grid">
      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">ST</span>
          <div>
            <h3>系统设置</h3>
            <p>集中展示模型、数据库、安全、通知和审计配置状态。</p>
          </div>
        </div>
        <div className="workspace-subtabs" role="tablist" aria-label="系统设置分类">
          <button className={tab === 'model' ? 'active' : ''} role="tab" type="button" onClick={() => setTab('model')}>
            模型配置
          </button>
          <button className={tab === 'database' ? 'active' : ''} role="tab" type="button" onClick={() => setTab('database')}>
            数据库
          </button>
          <button className={tab === 'security' ? 'active' : ''} role="tab" type="button" onClick={() => setTab('security')}>
            安全审计
          </button>
          <button className={tab === 'notice' ? 'active' : ''} role="tab" type="button" onClick={() => setTab('notice')}>
            通知配置
          </button>
        </div>
        <div className="summary-grid summary-grid-strong">
          <div className="summary-card">
            <span>{tab === 'model' ? '模型网关' : tab === 'database' ? '数据库' : tab === 'security' ? '接口安全' : '通知通道'}</span>
            <strong>{tab === 'model' ? 'Agnes APIHub 已配置' : tab === 'database' ? 'PostgreSQL' : tab === 'security' ? '限流 / 请求体限制 / 安全响应头' : '站内通知'}</strong>
          </div>
          <div className="summary-card">
            <span>敏感配置</span>
            <strong>已脱敏展示</strong>
            <button className="action-button secondary-button" type="button" onClick={() => setEditingSecret((current) => !current)}>
              编辑敏感配置
            </button>
          </div>
        </div>
        {editingSecret ? (
          <div className="history-detail-block">
            <h4>敏感配置编辑</h4>
            <input className="text-input" type="password" aria-label="密钥输入" placeholder="输入新密钥" />
          </div>
        ) : null}
        <div className="history-detail-block">
          <h4>企业级配置检查</h4>
          <ul className="context-risk-list">
            {checks.map((check) => (
              <li key={check}>
                <span className="status-chip status-chip-success">已合规</span>
                {check}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
