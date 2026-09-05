import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import EmptyState from '../components/feedback/EmptyState';
import PageSkeleton from '../components/feedback/PageSkeleton';
import { usePageFeedback } from '../components/feedback/usePageFeedback';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import { workspaceFetch } from '../utils/workspaceIdentity';

type TemplateRecord = { id: string; name: string; tag: string; description: string; request: string; summary: string };

function TemplatesPage() {
  const navigate = useNavigate();
  const { setActiveTask } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { status, statusTone, setStatus, notify } = usePageFeedback();

  useEffect(() => {
    setLoading(true);
    void workspaceFetch(`${apiBaseUrl}/api/templates`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => setTemplates(items))
      .catch(() => notify('无法读取模板库', { tone: 'danger' }))
      .finally(() => setLoading(false));
  }, [apiBaseUrl]);

  const useTemplate = async (template: TemplateRecord) => {
    const response = await workspaceFetch(`${apiBaseUrl}/api/templates/${encodeURIComponent(template.id)}/activate`, { method: 'POST' });
    if (!response.ok) {
      notify('创建模板任务失败', { tone: 'danger' });
      return;
    }
    setActiveTask(await response.json());
    notify('已从模板创建任务', { description: '正在进入说明问题。', tone: 'success' });
    navigate('/workspace?step=input');
  };

  return (
    <div className="workspace-grid compact-page">
      <section className="enterprise-page-hero">
        <div className="enterprise-page-title-row">
          <div>
            <h3>分析模板中心</h3>
            <p>统一管理沉淀下来的分析需求、报告结构和复用方案，快速生成一个可直接执行的新任务。</p>
          </div>
          <div className="enterprise-page-actions">
            <button className="action-button" type="button" onClick={() => navigate('/workspace?step=input')}>新建空白任务</button>
            <button className="action-button secondary-button" type="button" onClick={() => navigate('/history')}>查看历史任务</button>
          </div>
        </div>
      </section>

      <section className="enterprise-metric-strip">
        <article className="enterprise-metric-card">
          <span>模板总数</span>
          <strong>{templates.length}</strong>
          <small>当前可用模板</small>
        </article>
        <article className="enterprise-metric-card">
          <span>推荐模板</span>
          <strong>{templates.filter((item) => item.tag.includes('推荐')).length}</strong>
          <small>适合直接开箱使用</small>
        </article>
        <article className="enterprise-metric-card">
          <span>排障模板</span>
          <strong>{templates.filter((item) => item.tag.includes('排')).length}</strong>
          <small>偏异常分析与复盘</small>
        </article>
        <article className="enterprise-metric-card">
          <span>当前状态</span>
          <strong>{status || '可直接使用模板'}</strong>
          <small>从模板创建后会跳转到说明问题页</small>
        </article>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <div>
            <h3>模板列表</h3>
            <p>从持久化需求与报告模板创建新的服务端任务。</p>
          </div>
        </div>
        {loading ? <PageSkeleton title="模板加载中" description="正在读取可复用分析模板…" cards={3} rows={3} compact /> : null}
        {status ? <p className={`status-note status-note-${statusTone}`}>{status}</p> : null}
        <div className="history-list history-list-grid">
          {templates.map((template) => (
            <article className="history-card" key={template.id}>
              <div className="history-card-header">
                <h4>{template.name}</h4>
                <span className="history-badge">{template.tag}</span>
              </div>
              <p>{template.description}</p>
              <div className="actions-row">
                <button className="action-button" type="button" onClick={() => void useTemplate(template)}>使用模板</button>
              </div>
            </article>
          ))}
          {!loading && templates.length === 0 ? (
          <EmptyState
            icon="TP"
            title="还没有分析模板"
            description="在工作台完成一次分析后，可把当前任务保存为模板，下次一键复用。"
            primaryLabel="进入工作台"
            onPrimary={() => navigate('/workspace?step=input')}
            secondaryLabel="查看历史任务"
            onSecondary={() => navigate('/history')}
          />
        ) : null}
        </div>
      </section>
    </div>
  );
}

export default TemplatesPage;
