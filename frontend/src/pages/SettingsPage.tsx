function SettingsPage() {
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
        <div className="summary-grid summary-grid-strong">
          <div className="summary-card">
            <span>模型网关</span>
            <strong>Agnes APIHub 已配置</strong>
          </div>
          <div className="summary-card">
            <span>数据库</span>
            <strong>PostgreSQL</strong>
          </div>
          <div className="summary-card">
            <span>接口安全</span>
            <strong>限流 / 请求体限制 / 安全响应头</strong>
          </div>
          <div className="summary-card">
            <span>审计日志</span>
            <strong>任务事件留存</strong>
          </div>
        </div>
        <div className="history-detail-block">
          <h4>企业级配置检查</h4>
          <ul className="context-risk-list">
            <li>生产环境需要使用独立密钥管理，不把密钥写入仓库。</li>
            <li>数据库建议启用备份、监控和迁移审批。</li>
            <li>正式多租户场景需要接入账号权限和部门隔离。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
