import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DataSourceUploader from '../components/data/DataSourceUploader';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskDataSourceRecord } from '../types/tasks';
import { withWorkspaceQuery, workspaceFetch } from '../utils/workspaceIdentity';
import { canAdmin, canWrite } from '../utils/permissions';
import { runFullDemoFlow, type DemoProgress } from '../utils/demoFlow';
import DemoProgressBar from '../components/demo/DemoProgressBar';

type ApiDataset = TaskDataSourceRecord & {
  id: string;
  name: string;
  profile?: { nullCounts?: Record<string, number>; duplicateRows?: number };
  analysisScope?: { mode?: string; rowCount?: number; rowsProcessed?: number };
  originalFileSize?: number;
  sourceType?: string;
  connectorType?: string;
  connectionId?: string;
};

type ConnectorType = {
  type: string;
  name: string;
  description: string;
};

type ConnectionItem = {
  id: string;
  name: string;
  connectorType: string;
  config: Record<string, unknown>;
  hasCredentials: boolean;
  lastTestStatus?: string;
  lastTestedAt?: string;
  lastImportAt?: string;
};

function formatFileSize(bytes = 0) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function DataSourcesPage() {
  const navigate = useNavigate();
  const { activeTask, setActiveTask } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [datasets, setDatasets] = useState<ApiDataset[]>([]);
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [connectorTypes, setConnectorTypes] = useState<ConnectorType[]>([]);
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState('');
  const [lastReadyDataset, setLastReadyDataset] = useState<ApiDataset | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoProgress, setDemoProgress] = useState<DemoProgress | null>(null);
  const [connName, setConnName] = useState('网页数据源');
  const [connectorType, setConnectorType] = useState('web_page');
  const [httpUrl, setHttpUrl] = useState('https://example.com/report');
  const [jsonPath, setJsonPath] = useState('data.items');
  const [webExtractMode, setWebExtractMode] = useState<'auto' | 'table' | 'text'>('auto');
  const [webTableIndex, setWebTableIndex] = useState('1');
  const [bearerToken, setBearerToken] = useState('');
  const [pgHost, setPgHost] = useState('127.0.0.1');
  const [pgPort, setPgPort] = useState('5432');
  const [pgDatabase, setPgDatabase] = useState('analytics');
  const [pgQuery, setPgQuery] = useState('select region, sales from sales limit 100');
  const [pgUser, setPgUser] = useState('');
  const [pgPassword, setPgPassword] = useState('');
  const writeEnabled = canWrite();
  const adminEnabled = canAdmin();

  const selectedType = useMemo(
    () => connectorTypes.find((item) => item.type === connectorType),
    [connectorTypes, connectorType],
  );

  const loadDatasets = () => {
    void workspaceFetch(`${apiBaseUrl}/api/datasets`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => setDatasets(items))
      .catch(() => setStatus('无法读取数据源列表。'));
  };

  const loadConnections = () => {
    void workspaceFetch(`${apiBaseUrl}/api/connections`)
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((payload) => setConnections(payload.items || []))
      .catch(() => undefined);
  };

  const loadConnectorTypes = () => {
    void workspaceFetch(`${apiBaseUrl}/api/connectors/types`)
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((payload) => {
        const items = payload.items || [];
        setConnectorTypes(items);
        if (items[0]?.type) setConnectorType(items[0].type);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadDatasets();
    loadConnections();
    loadConnectorTypes();
  }, [apiBaseUrl]);

  const goStartAnalysis = () => {
    navigate('/workspace?step=input');
  };

  const startDemo = async () => {
    if (!writeEnabled || demoLoading) return;
    setDemoLoading(true);
    setStatus('正在启动完整示例演示…');
    try {
      const result = await runFullDemoFlow({
        apiBaseUrl,
        currentTask: activeTask,
        autoStart: true,
        onProgress: (progress) => {
          setDemoProgress(progress);
          setStatus(progress.detail || progress.label);
        },
        onTask: (task) => {
          setActiveTask(task);
          if (task.dataSource) {
            const dataset: ApiDataset = {
              ...(task.dataSource as ApiDataset),
              id:
                'id' in (task.dataSource as ApiDataset)
                  ? String((task.dataSource as ApiDataset).id || 'demo-sales-2025')
                  : 'demo-sales-2025',
              name: task.dataSource.fileName,
            };
            setDatasets((current) => [
              dataset,
              ...current.filter((item) => item.id !== dataset.id && item.name !== dataset.name),
            ]);
            setLastReadyDataset(dataset);
          }
        },
      });
      if (result.reachedDelivery) {
        setStatus('示例演示完成，正在进入报告交付…');
        navigate('/workspace?step=output');
      } else {
        setStatus('示例已启动，正在进入执行页…');
        navigate('/workspace?step=execution');
      }
    } catch {
      setDemoProgress({ stage: 'error', percent: 100, label: '演示失败', detail: '请稍后重试。' });
      setStatus('示例演示启动失败，请稍后重试。');
    } finally {
      setDemoLoading(false);
    }
  };

  const handleImportedDataSource = (dataSource: TaskDataSourceRecord) => {
    const dataset: ApiDataset = {
      ...dataSource,
      id:
        'id' in dataSource
          ? String((dataSource as ApiDataset).id || `local-${dataSource.fileName}`)
          : `local-${dataSource.fileName}`,
      name:
        'name' in dataSource
          ? String((dataSource as ApiDataset).name || dataSource.fileName)
          : dataSource.fileName,
    };
    setDatasets((current) => [
      dataset,
      ...current.filter((item) => item.name !== dataset.name && item.id !== dataset.id),
    ]);
    setLastReadyDataset(dataset);
    setStatus(`已上传 ${dataset.name}。可点击“立即开始分析”一键进入工作台。`);
  };

  const attachDataset = async (dataset: ApiDataset, options?: { startAnalysis?: boolean }) => {
    if (!writeEnabled) {
      setStatus('当前角色为只读，无法绑定数据源。');
      return false;
    }
    const startAnalysis = Boolean(options?.startAnalysis);
    setBusyId(`${dataset.id}:${startAnalysis ? 'start' : 'bind'}`);
    setStatus(startAnalysis ? '正在绑定并准备进入分析...' : '正在绑定数据源...');
    try {
      if (!apiBaseUrl || dataset.id.startsWith('local-')) {
        setActiveTask({ ...activeTask, dataSource: dataset, status: '等待需求解析' });
        setLastReadyDataset(dataset);
        if (startAnalysis) {
          setStatus(`已绑定 ${dataset.name}，正在进入分析工作台...`);
          navigate('/workspace?step=input');
        } else {
          setStatus(`已绑定 ${dataset.name}，可以进入工作台配置需求。`);
        }
        return true;
      }
      const response = await workspaceFetch(
        `${apiBaseUrl}/api/tasks/active/dataset/${encodeURIComponent(dataset.id)}`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setStatus('绑定数据源失败。');
        return false;
      }
      const task = await response.json();
      setActiveTask(task);
      setLastReadyDataset(dataset);
      if (startAnalysis) {
        setStatus(`已绑定 ${dataset.name}，正在进入分析工作台...`);
        navigate('/workspace?step=input');
      } else {
        setStatus(`已绑定 ${dataset.name}，可以进入工作台配置需求。`);
      }
      return true;
    } finally {
      setBusyId('');
    }
  };

  const deleteDataset = async (dataset: ApiDataset) => {
    if (!adminEnabled) {
      setStatus('删除数据源需要管理员权限。');
      return;
    }
    if (!window.confirm(`确认删除数据源“${dataset.name}”吗？`)) return;
    if (!apiBaseUrl || dataset.id.startsWith('local-')) {
      setDatasets((current) => current.filter((item) => item.id !== dataset.id));
      if (lastReadyDataset?.id === dataset.id) setLastReadyDataset(null);
      setStatus(`已删除 ${dataset.name}。`);
      return;
    }
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/datasets/${encodeURIComponent(dataset.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      if (response.status === 409) {
        setStatus('当前任务正在使用该数据源，请先切换或重置当前任务。');
        return;
      }
      setStatus('删除数据源失败。');
      return;
    }
    setDatasets((current) => current.filter((item) => item.id !== dataset.id));
    if (lastReadyDataset?.id === dataset.id) setLastReadyDataset(null);
    setStatus(`已删除 ${dataset.name}。`);
  };

  const buildConnectionPayload = () => {
    if (connectorType === 'postgres') {
      return {
        name: connName,
        connectorType: 'postgres',
        config: {
          host: pgHost,
          port: Number(pgPort || 5432),
          database: pgDatabase,
          query: pgQuery,
          sslmode: 'prefer',
        },
        credentials: {
          username: pgUser,
          password: pgPassword,
        },
      };
    }
    if (connectorType === 'web_page') {
      return {
        name: connName,
        connectorType: 'web_page',
        config: {
          url: httpUrl,
          extractMode: webExtractMode,
          tableIndex: Number(webTableIndex || 1),
        },
        credentials: bearerToken ? { bearerToken } : {},
      };
    }
    return {
      name: connName,
      connectorType: 'http_json',
      config: {
        url: httpUrl,
        method: 'GET',
        jsonPath,
      },
      credentials: bearerToken ? { bearerToken } : {},
    };
  };

  const createConnection = async () => {
    if (!writeEnabled) {
      setStatus('当前角色为只读，无法创建连接。');
      return;
    }
    setStatus('正在保存外部连接...');
    const response = await workspaceFetch(`${apiBaseUrl}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConnectionPayload()),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus(payload?.error?.message || '保存连接失败。');
      return;
    }
    const connection = await response.json();
    setConnections((current) => [connection, ...current.filter((item) => item.id !== connection.id)]);
    setStatus(`已保存连接：${connection.name}`);
  };

  const testConnection = async (connection: ConnectionItem) => {
    if (!writeEnabled) return;
    setStatus(`正在测试连接：${connection.name}`);
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/connections/${encodeURIComponent(connection.id)}/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus(payload?.error?.message || '连接测试失败。');
      loadConnections();
      return;
    }
    const result = await response.json();
    setStatus(`连接可用：${result.rowCount} 行 / ${result.columnCount} 列`);
    loadConnections();
  };

  const importConnection = async (
    connection: ConnectionItem,
    options?: { startAnalysis?: boolean },
  ) => {
    if (!writeEnabled) return;
    const startAnalysis = Boolean(options?.startAnalysis);
    setBusyId(`${connection.id}:${startAnalysis ? 'import-start' : 'import'}`);
    setStatus(
      startAnalysis
        ? `正在导入并准备分析：${connection.name}`
        : `正在从连接导入：${connection.name}`,
    );
    try {
      const response = await workspaceFetch(
        `${apiBaseUrl}/api/connections/${encodeURIComponent(connection.id)}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ datasetName: connection.name }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setStatus(payload?.error?.message || '导入失败。');
        return;
      }
      const dataset = (await response.json()) as ApiDataset;
      setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      loadConnections();
      if (startAnalysis) {
        await attachDataset(dataset, { startAnalysis: true });
      } else {
        setLastReadyDataset(dataset);
        setStatus(
          `已导入数据集：${dataset.name || dataset.fileName}。可点击“立即开始分析”。`,
        );
      }
    } finally {
      setBusyId('');
    }
  };

  const deleteConnection = async (connection: ConnectionItem) => {
    if (!adminEnabled) {
      setStatus('删除连接需要管理员权限。');
      return;
    }
    if (!window.confirm(`确认删除连接“${connection.name}”吗？`)) return;
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/connections/${encodeURIComponent(connection.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      setStatus('删除连接失败。');
      return;
    }
    setConnections((current) => current.filter((item) => item.id !== connection.id));
    setStatus(`已删除连接：${connection.name}`);
  };

  return (
    <div className="workspace-grid compact-page data-sources-page">
      <section className="enterprise-page-hero">
        <span className="enterprise-page-kicker">数据接入 / 一键进入分析</span>
        <div className="enterprise-page-title-row">
          <div>
            <h3>数据源管理</h3>
            <p>上传文件或连接外部源后，可一键绑定并进入分析工作台，减少页面来回跳转。</p>
          </div>
          <div className="enterprise-page-actions">
            <button
              className="action-button"
              type="button"
              disabled={!writeEnabled || demoLoading}
              onClick={() => void startDemo()}
            >
              {demoLoading ? '准备示例中…' : '一键示例演示'}
            </button>
            <button className="action-button secondary-button" type="button" onClick={goStartAnalysis}>
              进入分析工作台
            </button>
            <button
              className="action-button secondary-button"
              type="button"
              onClick={() => navigate('/workspace?step=execution')}
            >
              查看执行
            </button>
          </div>
        </div>
      </section>

      <DemoProgressBar progress={demoProgress} />

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">DS</span>
          <div>
            <h3>本地上传</h3>
            <p>支持 CSV / Excel / 文档。上传完成后可立即开始分析。</p>
          </div>
        </div>
        {writeEnabled ? (
          <DataSourceUploader onImportDataSource={handleImportedDataSource} showPreview />
        ) : (
          <p className="status-note">当前角色为只读，仅可查看与下载已有数据源。</p>
        )}
        {status ? <p className="status-note">{status}</p> : null}
      </section>

      {lastReadyDataset ? (
        <section className="ops-guide-banner data-source-ready-banner">
          <div>
            <strong>数据已就绪：{lastReadyDataset.name || lastReadyDataset.fileName}</strong>
            <p>可直接进入分析工作台填写需求并启动多 Agent 流程。</p>
          </div>
          <div className="actions-row">
            <button
              className="action-button"
              type="button"
              disabled={!writeEnabled || Boolean(busyId)}
              onClick={() => void attachDataset(lastReadyDataset, { startAnalysis: true })}
            >
              {busyId.endsWith(':start') || busyId.endsWith('import-start') ? '处理中…' : '立即开始分析'}
            </button>
            <button className="action-button secondary-button" type="button" onClick={goStartAnalysis}>
              仅进入工作台
            </button>
          </div>
        </section>
      ) : null}

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">CN</span>
          <div>
            <h3>外部连接器</h3>
            <p>
              {selectedType?.description ||
                '创建外部连接，测试后可导入为可分析数据集。网页抓取支持自动提取表格或正文。'}
            </p>
          </div>
        </div>
        {writeEnabled ? (
          <div className="form-grid">
            <label className="field-label">
              <span>连接名称</span>
              <input className="text-input" value={connName} onChange={(event) => setConnName(event.target.value)} />
            </label>
            <label className="field-label">
              <span>连接类型</span>
              <select
                className="text-input"
                value={connectorType}
                onChange={(event) => setConnectorType(event.target.value)}
              >
                {(connectorTypes.length
                  ? connectorTypes
                  : [
                      { type: 'web_page', name: '网页抓取' },
                      { type: 'http_json', name: 'HTTP JSON' },
                      { type: 'postgres', name: 'PostgreSQL' },
                    ]
                ).map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {connectorType === 'postgres' ? (
              <>
                <label className="field-label">
                  <span>Host</span>
                  <input className="text-input" value={pgHost} onChange={(event) => setPgHost(event.target.value)} />
                </label>
                <label className="field-label">
                  <span>Port</span>
                  <input className="text-input" value={pgPort} onChange={(event) => setPgPort(event.target.value)} />
                </label>
                <label className="field-label">
                  <span>Database</span>
                  <input
                    className="text-input"
                    value={pgDatabase}
                    onChange={(event) => setPgDatabase(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  <span>SQL</span>
                  <input className="text-input" value={pgQuery} onChange={(event) => setPgQuery(event.target.value)} />
                </label>
                <label className="field-label">
                  <span>用户名</span>
                  <input className="text-input" value={pgUser} onChange={(event) => setPgUser(event.target.value)} />
                </label>
                <label className="field-label">
                  <span>密码</span>
                  <input
                    className="text-input"
                    type="password"
                    value={pgPassword}
                    onChange={(event) => setPgPassword(event.target.value)}
                  />
                </label>
              </>
            ) : connectorType === 'web_page' ? (
              <>
                <label className="field-label">
                  <span>网页 URL</span>
                  <input
                    className="text-input"
                    value={httpUrl}
                    onChange={(event) => setHttpUrl(event.target.value)}
                    placeholder="https://example.com/page-with-table"
                  />
                </label>
                <label className="field-label">
                  <span>提取模式</span>
                  <select
                    className="text-input"
                    value={webExtractMode}
                    onChange={(event) => setWebExtractMode(event.target.value as 'auto' | 'table' | 'text')}
                  >
                    <option value="auto">自动（优先表格）</option>
                    <option value="table">仅表格</option>
                    <option value="text">仅正文文本</option>
                  </select>
                </label>
                <label className="field-label">
                  <span>表格序号（从 1 开始）</span>
                  <input
                    className="text-input"
                    value={webTableIndex}
                    onChange={(event) => setWebTableIndex(event.target.value)}
                    placeholder="1"
                  />
                </label>
                <label className="field-label">
                  <span>Bearer Token（可选）</span>
                  <input
                    className="text-input"
                    type="password"
                    value={bearerToken}
                    onChange={(event) => setBearerToken(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field-label">
                  <span>URL</span>
                  <input className="text-input" value={httpUrl} onChange={(event) => setHttpUrl(event.target.value)} />
                </label>
                <label className="field-label">
                  <span>JSON Path</span>
                  <input
                    className="text-input"
                    value={jsonPath}
                    onChange={(event) => setJsonPath(event.target.value)}
                    placeholder="data.items"
                  />
                </label>
                <label className="field-label">
                  <span>Bearer Token（可选）</span>
                  <input
                    className="text-input"
                    type="password"
                    value={bearerToken}
                    onChange={(event) => setBearerToken(event.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        ) : null}
        {writeEnabled ? (
          <div className="actions-row">
            <button className="action-button" type="button" onClick={() => void createConnection()}>
              保存连接
            </button>
          </div>
        ) : null}

        <div className="history-list history-list-grid" style={{ marginTop: 16 }}>
          {connections.map((connection) => (
            <article className="history-card data-source-card" key={connection.id}>
              <div className="history-card-header">
                <h4>{connection.name}</h4>
                <span className="history-badge">{connection.connectorType}</span>
              </div>
              <p>{connection.hasCredentials ? '已配置凭据（加密存储）' : '未配置凭据'}</p>
              <p className="status-note">{`最近测试：${connection.lastTestStatus || '未测试'}`}</p>
              <div className="actions-row">
                <button
                  className="action-button"
                  type="button"
                  disabled={!writeEnabled}
                  onClick={() => void testConnection(connection)}
                >
                  测试连接
                </button>
                <button
                  className="action-button secondary-button"
                  type="button"
                  disabled={!writeEnabled || Boolean(busyId)}
                  onClick={() => void importConnection(connection)}
                >
                  导入数据集
                </button>
                <button
                  className="action-button"
                  type="button"
                  disabled={!writeEnabled || Boolean(busyId)}
                  onClick={() => void importConnection(connection, { startAnalysis: true })}
                >
                  导入并开始分析
                </button>
                <button
                  className="action-button tertiary-button"
                  type="button"
                  disabled={!adminEnabled}
                  onClick={() => void deleteConnection(connection)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
          {connections.length === 0 ? (
            <p className="status-note">暂无外部连接。可先保存 HTTP JSON 或 PostgreSQL 连接。</p>
          ) : null}
        </div>
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <span className="section-index">UP</span>
          <div>
            <h3>已接入数据源</h3>
            <p>{`${datasets.length} 个可复用数据源`}</p>
          </div>
        </div>
        <div className="history-list history-list-grid">
          {datasets.map((dataset) => (
            <article className="history-card data-source-card" key={dataset.id}>
              <div className="history-card-header">
                <h4>{dataset.name}</h4>
                <span className="history-badge">{dataset.formatLabel ?? dataset.kind}</span>
              </div>
              <p>
                {`${dataset.columnCount} 列 / ${dataset.rowCount} 行 / ${formatFileSize(dataset.originalFileSize)}`}
              </p>
              {dataset.sourceType === 'connector' ? (
                <p className="status-note">{`来源：外部连接 ${dataset.connectorType || ''}`}</p>
              ) : null}
              {dataset.analysisScope ? (
                <p className="status-note">
                  {`分析范围：${dataset.analysisScope.rowsProcessed ?? 0}/${dataset.analysisScope.rowCount ?? dataset.rowCount} 行（${dataset.analysisScope.mode ?? 'full'}）`}
                </p>
              ) : null}
              {dataset.profile?.duplicateRows ? (
                <p className="status-note">{`检测到 ${dataset.profile.duplicateRows} 条重复记录，尚未自动删除。`}</p>
              ) : null}
              <div className="actions-row">
                <button
                  className="action-button"
                  type="button"
                  disabled={!writeEnabled || Boolean(busyId)}
                  onClick={() => void attachDataset(dataset, { startAnalysis: true })}
                >
                  {busyId === `${dataset.id}:start` ? '处理中…' : '立即开始分析'}
                </button>
                <button
                  className="action-button secondary-button"
                  type="button"
                  disabled={!writeEnabled || Boolean(busyId)}
                  onClick={() => void attachDataset(dataset)}
                >
                  {busyId === `${dataset.id}:bind` ? '绑定中…' : '用于新分析'}
                </button>
                {dataset.storageKey ? (
                  <a
                    className="action-button secondary-button"
                    href={withWorkspaceQuery(`${apiBaseUrl}/api/datasets/${dataset.id}/download`)}
                  >
                    下载原文件
                  </a>
                ) : (
                  <span className="status-note">连接导入数据无可下载原文件</span>
                )}
                <button
                  className="action-button tertiary-button"
                  type="button"
                  disabled={!adminEnabled}
                  onClick={() => void deleteDataset(dataset)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
          {datasets.length === 0 ? (
            <p className="status-note">暂无数据源。上传文件或从外部连接导入后将在这里显示。</p>
          ) : null}
        </div>
      </section>

      {activeTask.dataSource ? (
        <section className="content-card workspace-section">
          <div className="section-heading">
            <span className="section-index">NOW</span>
            <div>
              <h3>当前分析数据源</h3>
              <p>已绑定到工作台会话，可直接继续分析。</p>
            </div>
          </div>
          <div className="workspace-source-summary">
            <strong>{activeTask.dataSource.fileName}</strong>
            <p>{activeTask.status}</p>
          </div>
          <div className="actions-row">
            <button className="action-button" type="button" onClick={goStartAnalysis}>
              进入分析工作台
            </button>
            <button
              className="action-button secondary-button"
              type="button"
              onClick={() => navigate('/workspace?step=execution')}
            >
              进入执行监控
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default DataSourcesPage;
