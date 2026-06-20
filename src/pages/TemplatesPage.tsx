import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import { createMockTaskRepository, type TemplateRecord } from '../mock/mockTaskRepository';

const repository = createMockTaskRepository();

function TemplatesPage() {
  const navigate = useNavigate();
  const { setActiveTask } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
  const [favoriteNames, setFavoriteNames] = useState<string[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>(() => repository.listTemplates());
  const [loading, setLoading] = useState(Boolean(apiBaseUrl));

  useEffect(() => {
    let cancelled = false;

    const loadTemplates = async () => {
      setLoading(true);
      try {
        if (!apiBaseUrl) {
          const nextTemplates = repository.listTemplates();

          if (!cancelled) {
            setTemplates(nextTemplates);
            setLoading(false);
          }

          return;
        }

        const response = await fetch(`${apiBaseUrl}/api/templates`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Template fetch failed: ${response.status}`);
        }

        const nextTemplates = (await response.json()) as TemplateRecord[];

        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      } catch {
        const nextTemplates = repository.listTemplates();

        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const sortedTemplates = useMemo(() => {
    const favoriteSet = new Set(favoriteNames);
    return [...templates].sort((left, right) => {
      const leftScore = favoriteSet.has(left.name) ? 1 : 0;
      const rightScore = favoriteSet.has(right.name) ? 1 : 0;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return templates.findIndex((item) => item.id === left.id) - templates.findIndex((item) => item.id === right.id);
    });
  }, [favoriteNames, templates]);

  const handleUseTemplate = (template: TemplateRecord) => {
    const activeTask = apiBaseUrl
      ? {
          ...repository.getActiveTask(),
          name: template.name,
          request: template.request,
          summary: template.summary,
        }
      : repository.createTaskFromTemplate({
          name: template.name,
          request: template.request,
          summary: template.summary,
        });

    setActiveTask(activeTask);
    navigate('/workspace');
  };

  const handleDuplicateTemplate = (templateId: string) => {
    repository.duplicateTemplate(templateId);
    setTemplates(repository.listTemplates());
  };

  const toggleFavorite = (templateName: string) => {
    setFavoriteNames((current) =>
      current.includes(templateName) ? current.filter((item) => item !== templateName) : [...current, templateName],
    );
  };

  return (
    <div className="workspace-grid">
      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">TL</span>
          <div>
            <h3>模板库</h3>
            <p>复用已验证的需求模板、流程结构和导出模式，缩短新任务配置时间。</p>
          </div>
        </div>
        {loading ? (
          <div className="history-detail-block">
            <h4>正在加载模板库</h4>
            <p>页面已切换，正在读取可复用模板和收藏状态。</p>
          </div>
        ) : null}
        <div className="history-list">
          {sortedTemplates.map((template) => {
            const isFavorite = favoriteNames.includes(template.name);

            return (
              <article className="history-card" key={template.id}>
                <div className="history-card-header">
                  <h4>{template.name}</h4>
                  <span className="history-badge history-badge-secondary">{isFavorite ? '已收藏' : template.tag}</span>
                </div>
                <p>{template.description}</p>
                <div className="actions-row">
                  <button className="action-button secondary-button" type="button" onClick={() => handleUseTemplate(template)}>
                    {`使用模板：${template.name}`}
                  </button>
                  <button className="action-button tertiary-button" type="button" onClick={() => handleDuplicateTemplate(template.id)}>
                    {`复制模板：${template.name}`}
                  </button>
                  <button className="action-button tertiary-button" type="button" onClick={() => toggleFavorite(template.name)}>
                    {isFavorite ? `取消收藏：${template.name}` : `收藏模板：${template.name}`}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="history-detail-block">
          <h4>后续迭代方向</h4>
          <ul className="context-risk-list">
            <li>将模板收藏、复制和版本备注整合到统一模板注册表。</li>
            <li>追踪模板与历史完成任务之间的血缘关系。</li>
            <li>统一模板页与历史页中的模板复用入口。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default TemplatesPage;
