import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import { createMockTaskRepository } from '../mock/mockTaskRepository';
import { buildSampleDataContext } from './workspaceSampleData';

const repository = createMockTaskRepository();

type ApiDataset = {
  id: string;
  name: string;
  kind: string;
  columnCount: number;
  rowCount: number;
  usedBy: string;
};

const sampleDatasets = [
  {
    name: '示例销售数据集',
    tag: '推荐试跑',
    description: '包含月份、区域、销售额，可直接进入工作台演示完整分析链路。',
    summary: '已从数据源页加载示例销售数据集，可继续补充分析需求并启动多 Agent 流程。',
  },
  {
    name: '近期复用数据集',
    tag: '最近使用',
    description: '沿用最近一次月报字段结构，适合快速复用工作台主流程。',
    summary: '已从数据源页复用近期数据集，请确认字段口径后继续生成分析结果。',
  },
];

function DataSourcesPage() {
  const navigate = useNavigate();
  const { setActiveTask, setContext } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL;
  const [apiDatasets, setApiDatasets] = useState<ApiDataset[]>([]);
  const [activeTab, setActiveTab] = useState<'file' | 'database' | 'recent'>('file');

  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    void fetch(`${apiBaseUrl}/api/datasets`)
      .then((response) => (response.ok ? response.json() : []))
      .then((datasets: ApiDataset[]) => {
        if (!cancelled) setApiDatasets(datasets);
      })
      .catch(() => {
        if (!cancelled) setApiDatasets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const handleUseDataset = (dataset: (typeof sampleDatasets)[number]) => {
    const baseTask = repository.getActiveTask();
    const nextContext = buildSampleDataContext(baseTask.snapshot.context);
    const nextTask = repository.updateActiveTask({
      summary: dataset.summary,
      snapshot: {
        ...baseTask.snapshot,
        context: nextContext,
      },
      risks: nextContext.risks,
    });

    setContext(nextContext);
    setActiveTask(nextTask);
    navigate('/workspace');
  };

  return (
    <div className="workspace-grid">
      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">DS</span>
          <div>
            <h3>数据源管理</h3>
            <p>集中管理上传文件、数据库接入口和最近可复用的数据集，支持直接带数据进入工作台。</p>
          </div>
        </div>
        <div className="summary-grid summary-grid-strong">
          <button className={activeTab === 'file' ? 'summary-card active-tab-card' : 'summary-card'} role="tab" aria-label="本地文件" type="button" onClick={() => setActiveTab('file')}>
            <span>本地文件</span>
            <strong>支持 CSV / Excel 样例接入</strong>
          </button>
          <button className={activeTab === 'database' ? 'summary-card active-tab-card' : 'summary-card'} role="tab" aria-label="数据库直连" type="button" onClick={() => setActiveTab('database')}>
            <span>数据库直连</span>
            <strong>PostgreSQL / MySQL</strong>
          </button>
          <button className={activeTab === 'recent' ? 'summary-card active-tab-card' : 'summary-card'} role="tab" aria-label="近期复用" type="button" onClick={() => setActiveTab('recent')}>
            <span>近期复用</span>
            <strong>复用历史字段结构</strong>
          </button>
        </div>
        <div className="history-list history-list-grid">
          {(activeTab !== 'file' ? apiDatasets : []).map((dataset) => (
            <article className="history-card" key={dataset.id}>
              <div className="history-card-header">
                <h4>{dataset.name}</h4>
                <span className="history-badge history-badge-secondary">{dataset.kind}</span>
              </div>
              <p>{`${dataset.columnCount} 个字段 / ${dataset.rowCount} 行 / 使用于 ${dataset.usedBy}`}</p>
            </article>
          ))}
          {sampleDatasets.map((dataset) => (
            <article className="history-card" key={dataset.name}>
              <div className="history-card-header">
                <h4>{dataset.name}</h4>
                <span className="history-badge history-badge-secondary">{dataset.tag}</span>
              </div>
              <p>{dataset.description}</p>
              <div className="actions-row">
                <button className="action-button secondary-button" type="button" onClick={() => handleUseDataset(dataset)}>
                  快速新建任务
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="history-detail-block dev-only-note" aria-hidden="true">
          <h4>后续迭代方向</h4>
          <ul className="context-risk-list">
            <li>统一接入数据源连接表单与凭据校验。</li>
            <li>补充数据集列表、最近预览和复用入口。</li>
            <li>让上传区、数据源页和异步工作台共用同一套数据源状态。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default DataSourcesPage;
