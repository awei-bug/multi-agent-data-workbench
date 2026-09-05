import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DataSourceUploader from '../components/data/DataSourceUploader';
import { useOptionalToast } from '../components/feedback/ToastContext';
import { useWorkbenchShell } from '../context/WorkbenchShellContext';
import type { TaskDataSourceRecord } from '../types/tasks';
import { isDemoFlowEnabled, withTicketQuery, workspaceFetch } from '../utils/workspaceIdentity';
import { canAdmin, canWrite } from '../utils/permissions';
import { runFullDemoFlow, type DemoProgress } from '../utils/demoFlow';
import DemoProgressBar from '../components/demo/DemoProgressBar';
import EmptyState from '../components/feedback/EmptyState';
import PageSkeleton from '../components/feedback/PageSkeleton';
import { usePageFeedback } from '../components/feedback/usePageFeedback';

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
  const toastApi = useOptionalToast();
  const { status, statusTone, setStatus, notify } = usePageFeedback();
  const navigate = useNavigate();
  const { activeTask, setActiveTask } = useWorkbenchShell();
  const apiBaseUrl = import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? '';
  const [datasets, setDatasets] = useState<ApiDataset[]>([]);
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [connectorTypes, setConnectorTypes] = useState<ConnectorType[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [lastReadyDataset, setLastReadyDataset] = useState<ApiDataset | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoProgress, setDemoProgress] = useState<DemoProgress | null>(null);
  const [showAdvancedConnectors, setShowAdvancedConnectors] = useState(false);
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
  const [draftTesting, setDraftTesting] = useState(false);
  const [smartUrl, setSmartUrl] = useState('https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)');
  const [smartInstruction, setSmartInstruction] = useState('提取页面中的国家人口表格，保留国家名和人口数');
  const [smartFormat, setSmartFormat] = useState<'csv' | 'md' | 'json'>('csv');
  const [smartRenderJs, setSmartRenderJs] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartPreview, setSmartPreview] = useState<{
    fileName?: string;
    mimeType?: string;
    format?: string;
    byteSize?: number;
    contentBase64?: string;
    contentTextPreview?: string;
    kind?: string;
    strategy?: string;
    preview?: Array<Record<string, unknown> | string>;
    previewCount?: number;
    rows?: Array<Record<string, unknown>> | null;
    text?: string | null;
    paragraphs?: string[] | null;
    extractionMeta?: Record<string, unknown>;
    suggestedDatasetName?: string;
    message?: string;
    availableFields?: string[];
  } | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<number[]>([]);
  const [smartResult, setSmartResult] = useState<{
    datasetName?: string;
    format?: string;
    strategy?: string;
    kind?: string;
    message?: string;
  } | null>(null);
  const writeEnabled = canWrite();
  const adminEnabled = canAdmin();

  const selectedType = useMemo(
    () => connectorTypes.find((item) => item.type === connectorType),
    [connectorTypes, connectorType],
  );

  const connectorHelp = useMemo(() => {
    if (connectorType === 'postgres') {
      return {
        summary: '从 PostgreSQL 用一条 SELECT 查询导入表格数据。',
        tips: [
          'Host / Port / Database：数据库地址信息',
          'SQL：只支持查询语句（SELECT），建议加 LIMIT',
          '用户名/密码：会加密保存，仅用于连接测试与导入',
        ],
      };
    }
    if (connectorType === 'http_json') {
      return {
        summary: '从 HTTP JSON 接口拉取数组数据，转成可分析表格。',
        tips: [
          'URL：接口地址，通常是 GET',
          'JSON Path：数组所在路径，例如 data.items；留空则尝试根数组',
          'Bearer Token：可选，需要鉴权时再填',
        ],
      };
    }
    return {
      summary: '抓取公开网页里的表格或正文，导入后可继续分析。',
      tips: [
        '网页 URL：目标页面地址',
        '提取模式：auto 优先找表格；table 只抓表格；text 只抓正文',
        '表格序号：页面有多张表时，从 1 开始指定第几张',
        'Bearer Token：仅当网页接口需要鉴权时填写',
      ],
    };
  }, [connectorType]);

  const loadDatasets = () => {
    setListLoading(true);
    void workspaceFetch(`${apiBaseUrl}/api/datasets`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => setDatasets(items))
      .catch(() => notify('无法读取数据源列表', { tone: 'danger' }))
      .finally(() => setListLoading(false));
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
    toastApi?.pushToast({ title: '数据已选好', description: '正在进入下一步，说明你想分析什么。', tone: 'success' });
        navigate('/workspace?step=input');
  };

  const startDemo = async () => {
    if (!writeEnabled || demoLoading) return;
    if (!isDemoFlowEnabled()) {
      setStatus('生产环境已关闭示例演示，请上传真实数据。', 'warn');
      return;
    }
    setDemoLoading(true);
    setStatus('正在启动完整示例演示…', 'info');
    try {
      const result = await runFullDemoFlow({
        apiBaseUrl,
        currentTask: activeTask,
        autoStart: true,
        onProgress: (progress) => {
          setDemoProgress(progress);
          setStatus(progress.detail || progress.label, 'info');
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
        notify('示例演示完成', { description: '正在进入查看结果…', tone: 'success' });
        navigate('/workspace?step=output');
      } else {
        notify('示例已启动', { description: '正在进入执行页…', tone: 'success' });
        navigate('/workspace?step=execution');
      }
    } catch {
      setDemoProgress({ stage: 'error', percent: 100, label: '演示失败', detail: '请稍后重试。' });
      notify('示例演示启动失败', { description: '请稍后重试。', tone: 'danger' });
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
    notify('上传成功', { description: `${dataset.name} 已就绪，可立即开始分析。`, tone: 'success' });
  };

  const attachDataset = async (dataset: ApiDataset, options?: { startAnalysis?: boolean }) => {
    if (!writeEnabled) {
      notify('当前角色为只读', { description: '无法绑定数据源。', tone: 'warn' });
      return false;
    }
    const startAnalysis = Boolean(options?.startAnalysis);
    setBusyId(`${dataset.id}:${startAnalysis ? 'start' : 'bind'}`);
    setStatus(startAnalysis ? '正在绑定并准备进入分析...' : '正在绑定数据源...', 'info');
    try {
      if (!apiBaseUrl || dataset.id.startsWith('local-')) {
        setActiveTask({ ...activeTask, dataSource: dataset, status: '等待需求解析' });
        setLastReadyDataset(dataset);
        if (startAnalysis) {
          notify(`已绑定 ${dataset.name}，正在进入说明问题...`, { tone: 'success' });
          toastApi?.pushToast({ title: '数据已选好', description: '正在进入下一步，说明你想分析什么。', tone: 'success' });
        navigate('/workspace?step=input');
        } else {
          notify(`已绑定 ${dataset.name}，可以进入工作台配置需求。`, { tone: 'success' });
        }
        return true;
      }
      const response = await workspaceFetch(
        `${apiBaseUrl}/api/tasks/active/dataset/${encodeURIComponent(dataset.id)}`,
        { method: 'POST' },
      );
      if (!response.ok) {
        notify('绑定数据源失败', { tone: 'danger' });
        return false;
      }
      const task = await response.json();
      setActiveTask(task);
      setLastReadyDataset(dataset);
      if (startAnalysis) {
        notify(`已绑定 ${dataset.name}，正在进入说明问题...`, { tone: 'success' });
        toastApi?.pushToast({ title: '数据已选好', description: '正在进入下一步，说明你想分析什么。', tone: 'success' });
        navigate('/workspace?step=input');
      } else {
        notify(`已绑定 ${dataset.name}，可以进入工作台配置需求。`, { tone: 'success' });
      }
      return true;
    } finally {
      setBusyId('');
    }
  };

  const deleteDataset = async (dataset: ApiDataset) => {
    if (!adminEnabled) {
      notify('需要管理员权限', { description: '无法删除数据源。', tone: 'warn' });
      return;
    }
    if (!window.confirm(`确认删除数据源“${dataset.name}”吗？`)) return;
    if (!apiBaseUrl || dataset.id.startsWith('local-')) {
      setDatasets((current) => current.filter((item) => item.id !== dataset.id));
      if (lastReadyDataset?.id === dataset.id) setLastReadyDataset(null);
      notify(`已删除 ${dataset.name}。`, { tone: 'success' });
      return;
    }
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/datasets/${encodeURIComponent(dataset.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      if (response.status === 409) {
        notify('无法删除数据源', { description: '当前任务正在使用该数据源，请先切换或重置当前任务。', tone: 'warn' });
        return;
      }
      notify('删除数据源失败', { tone: 'danger' });
      return;
    }
    setDatasets((current) => current.filter((item) => item.id !== dataset.id));
    if (lastReadyDataset?.id === dataset.id) setLastReadyDataset(null);
    notify(`已删除 ${dataset.name}。`, { tone: 'success' });
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
      notify('当前角色为只读', { description: '无法创建连接。', tone: 'warn' });
      return;
    }
    const draft = buildConnectionPayload();
    if (!String(draft.name || '').trim()) {
      notify('请先填写连接名称', { tone: 'warn' });
      return;
    }
    if (connectorType === 'web_page' || connectorType === 'http_json') {
      if (!String(httpUrl || '').trim()) {
        notify('请先填写 URL', { tone: 'warn' });
        return;
      }
    }
    if (connectorType === 'postgres') {
      if (!String(pgHost || '').trim() || !String(pgDatabase || '').trim() || !String(pgQuery || '').trim()) {
        notify('请完整填写 Host、Database 与 SQL', { tone: 'warn' });
        return;
      }
    }
    setStatus('正在保存外部连接...', 'info');
    const response = await workspaceFetch(`${apiBaseUrl}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      notify('保存连接失败', {
        description: payload?.error?.message || payload?.detail || '请检查字段后重试',
        tone: 'danger',
      });
      return;
    }
    const connection = await response.json();
    setConnections((current) => [connection, ...current.filter((item) => item.id !== connection.id)]);
    notify('连接已保存', {
      description: `${connection.name}。下一步可点“测试连接”，确认后再“导入数据集”。`,
      tone: 'success',
    });
  };

  const testDraftConnection = async () => {
    if (!writeEnabled) return;
    const draft = buildConnectionPayload();
    setDraftTesting(true);
    setStatus('正在测试当前表单配置…', 'info');
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/connections/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectorType: draft.connectorType,
          config: draft.config,
          credentials: draft.credentials,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        notify('当前配置测试失败', {
          description: payload?.error?.message || payload?.detail || '请检查 URL / SQL / 凭据',
          tone: 'danger',
        });
        return;
      }
      const result = await response.json();
      notify('当前配置可用', {
        description: `预览约 ${result.rowCount ?? 0} 行 / ${result.columnCount ?? 0} 列。可继续点“保存连接”。`,
        tone: 'success',
      });
    } catch {
      notify('测试请求失败', { description: '请确认后端服务已启动。', tone: 'danger' });
    } finally {
      setDraftTesting(false);
    }
  };

  const runSmartScrapePreview = async () => {
    if (!writeEnabled) {
      notify('当前角色为只读', { description: '无法执行智能采集。', tone: 'warn' });
      return;
    }
    if (!smartUrl.trim()) {
      notify('请填写网页 URL', { tone: 'warn' });
      return;
    }
    if (!smartInstruction.trim()) {
      notify('请用自然语言说明要抓什么', { tone: 'warn' });
      return;
    }
    setSmartBusy(true);
    setSmartPreview(null);
    setSelectedFields([]);
    setSelectedRowIndexes([]);
    setSmartResult(null);
    setStatus(smartRenderJs ? '正在用浏览器渲染抓取并生成预览…' : '正在按指令抓取网页并生成预览…', 'info');
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/smart-scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: smartUrl.trim(),
          instruction: smartInstruction.trim(),
          outputFormat: smartFormat,
          commit: false,
          renderJs: smartRenderJs,
          datasetName: `智能采集-${new Date().toLocaleString('zh-CN')}`,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.error?.message ||
          payload?.detail?.message ||
          (typeof payload?.detail === 'string' ? payload.detail : '') ||
          '智能采集预览失败';
        notify('预览失败', { description: message, tone: 'danger' });
        return;
      }
      const result = await response.json();
      const rows = (result.extraction?.rows || null) as Array<Record<string, unknown>> | null;
      const preview = (result.extraction?.preview || []) as Array<Record<string, unknown> | string>;
      const fieldSource =
        (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] : null) ||
        (preview[0] && typeof preview[0] === 'object' ? (preview[0] as Record<string, unknown>) : null);
      const fields = fieldSource ? Object.keys(fieldSource) : [];
      const rowCount = Array.isArray(rows) ? rows.length : preview.length;
      setSelectedFields(fields);
      setSelectedRowIndexes(Array.from({ length: Math.min(rowCount, 200) }, (_, index) => index));
      setSmartPreview({
        fileName: result.file?.fileName,
        mimeType: result.file?.mimeType,
        format: result.file?.format,
        byteSize: result.file?.byteSize,
        contentBase64: result.file?.contentBase64,
        contentTextPreview: result.file?.contentTextPreview,
        kind: result.extraction?.kind,
        strategy: result.extraction?.meta?.strategy,
        preview,
        previewCount: result.extraction?.previewCount,
        rows,
        text: result.extraction?.text || null,
        paragraphs: result.extraction?.paragraphs || null,
        extractionMeta: result.extraction?.meta || {},
        suggestedDatasetName: result.suggestedDatasetName,
        message: result.message,
        availableFields: fields,
      });
      notify('预览已生成', {
        description: fields.length
          ? `可勾选字段和行后再确认导入（渲染模式：${result.extraction?.meta?.renderMode || 'static'}）。`
          : '请确认下方内容，再决定是否导入系统。',
        tone: 'success',
      });
    } catch {
      notify('预览请求失败', { description: '请确认后端服务已启动。', tone: 'danger' });
    } finally {
      setSmartBusy(false);
    }
  };

  const commitSmartScrape = async (options?: { startAnalysis?: boolean }) => {
    if (!writeEnabled || !smartPreview?.contentBase64 || !smartPreview.fileName) {
      notify('请先生成预览', { tone: 'warn' });
      return;
    }
    if (smartPreview.kind === 'table' && selectedFields.length === 0) {
      notify('请至少勾选 1 个字段', { tone: 'warn' });
      return;
    }
    if (smartPreview.kind === 'table' && selectedRowIndexes.length === 0) {
      notify('请至少勾选 1 行数据', { tone: 'warn' });
      return;
    }
    setSmartBusy(true);
    setStatus(options?.startAnalysis ? '正在确认导入并进入分析…' : '正在确认导入采集结果…', 'info');
    try {
      const response = await workspaceFetch(`${apiBaseUrl}/api/smart-scrape/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: smartUrl.trim(),
          instruction: smartInstruction.trim(),
          datasetName: smartPreview.suggestedDatasetName || `智能采集-${new Date().toLocaleString('zh-CN')}`,
          outputFormat: smartPreview.format || smartFormat,
          fileName: smartPreview.fileName,
          mimeType: smartPreview.mimeType || 'application/octet-stream',
          format: smartPreview.format || smartFormat,
          contentBase64: smartPreview.contentBase64,
          kind: smartPreview.kind,
          extractionMeta: smartPreview.extractionMeta || {},
          rows: smartPreview.rows || undefined,
          text: smartPreview.text || undefined,
          paragraphs: smartPreview.paragraphs || undefined,
          selectedFields: smartPreview.kind === 'table' ? selectedFields : undefined,
          selectedRowIndexes: smartPreview.kind === 'table' ? selectedRowIndexes : undefined,
          startAnalysis: Boolean(options?.startAnalysis),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.error?.message ||
          payload?.detail?.message ||
          (typeof payload?.detail === 'string' ? payload.detail : '') ||
          '确认导入失败';
        notify('确认导入失败', { description: message, tone: 'danger' });
        return;
      }
      const result = await response.json();
      const dataset = result.dataset as ApiDataset | undefined;
      if (dataset?.id) {
        setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
        setLastReadyDataset(dataset);
      }
      if (result.activeTask) {
        setActiveTask(result.activeTask);
      }
      setSmartResult({
        datasetName: dataset?.name || dataset?.fileName,
        format: result.file?.format || smartPreview.format,
        strategy: smartPreview.strategy,
        kind: smartPreview.kind || dataset?.kind,
        message: result.message,
      });
      setSmartPreview(null);
      setSelectedFields([]);
      setSelectedRowIndexes([]);
      notify('已确认导入', {
        description: `${result.file?.fileName || '采集文件'} 已进入数据源列表。`,
        tone: 'success',
      });
      if (options?.startAnalysis) {
        navigate('/workspace?step=input');
      }
    } catch {
      notify('确认导入请求失败', { description: '请确认后端服务已启动。', tone: 'danger' });
    } finally {
      setSmartBusy(false);
    }
  };

  const testConnection = async (connection: ConnectionItem) => {
    if (!writeEnabled) return;
    setStatus(`正在测试连接：${connection.name}`, 'info');
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
      notify('连接测试失败', { description: payload?.error?.message, tone: 'danger' });
      loadConnections();
      return;
    }
    const result = await response.json();
    notify('连接可用', { description: `${result.rowCount} 行 / ${result.columnCount} 列`, tone: 'success' });
    loadConnections();
  };

  const importConnection = async (
    connection: ConnectionItem,
    options?: { startAnalysis?: boolean },
  ) => {
    if (!writeEnabled) return;
    const startAnalysis = Boolean(options?.startAnalysis);
    setBusyId(`${connection.id}:${startAnalysis ? 'import-start' : 'import'}`);
    setStatus(startAnalysis ? `正在导入并准备分析：${connection.name}` : `正在从连接导入：${connection.name}`, 'info');
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
        notify('导入失败', { description: payload?.error?.message, tone: 'danger' });
        return;
      }
      const dataset = (await response.json()) as ApiDataset;
      setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      loadConnections();
      if (startAnalysis) {
        await attachDataset(dataset, { startAnalysis: true });
      } else {
        setLastReadyDataset(dataset);
        notify('导入成功', { description: `${dataset.name || dataset.fileName}，可立即开始分析。`, tone: 'success' });
      }
    } finally {
      setBusyId('');
    }
  };

  const deleteConnection = async (connection: ConnectionItem) => {
    if (!adminEnabled) {
      notify('需要管理员权限', { description: '无法删除连接。', tone: 'warn' });
      return;
    }
    if (!window.confirm(`确认删除连接“${connection.name}”吗？`)) return;
    const response = await workspaceFetch(
      `${apiBaseUrl}/api/connections/${encodeURIComponent(connection.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      notify('删除连接失败', { tone: 'danger' });
      return;
    }
    setConnections((current) => current.filter((item) => item.id !== connection.id));
    notify('连接已删除', { description: connection.name, tone: 'success' });
  };

  return (
    <div className="workspace-grid compact-page data-sources-page">
      <section className="enterprise-page-hero">
        <div className="enterprise-page-title-row">
          <div>
            <h3>上传数据</h3>
            <p>拖入表格或文档。上传后一键进入分析，不用来回找菜单。</p>
          </div>
          <div className="enterprise-page-actions">
            <button
              className="action-button"
              type="button"
              disabled={!writeEnabled || demoLoading}
              onClick={() => void startDemo()}
            >
              {demoLoading ? '准备示例中…' : '不会用？先看示例'}
            </button>
            {activeTask.dataSource ? (
              <button className="action-button secondary-button" type="button" onClick={goStartAnalysis}>
                数据已就绪，去说明问题
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <DemoProgressBar progress={demoProgress} />

      <section className="content-card workspace-section">
        <div className="section-heading">
          <div>
            <h3>智能网页采集（自然语言）</h3>
            <p>输入网址 + 你想要的内容说明，系统会抓取相关内容、生成文件并导入为可分析数据源。</p>
          </div>
        </div>
        {writeEnabled ? (
          <div className="form-grid">
            <div className="flow-alert flow-alert-info" style={{ gridColumn: '1 / -1' }}>
              <strong>这和“网页抓取连接”有什么区别？</strong>
              <p>
                旧连接器主要抽 HTML 表格；智能采集支持你用自然语言描述目标（例如“提取人口排名表”或“总结页面核心观点”），
                并自动生成 CSV / Markdown / JSON 文件后再导入系统。
              </p>
            </div>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>
              <span>网页 URL</span>
              <input
                className="text-input"
                value={smartUrl}
                onChange={(event) => setSmartUrl(event.target.value)}
                placeholder="https://example.com/report"
              />
              <small className="field-hint">建议用带公开内容/表格的页面；强登录或纯 JS 页面可能抓不全。</small>
            </label>
            <label className="field-label" style={{ gridColumn: '1 / -1' }}>
              <span>你想抓什么（自然语言）</span>
              <textarea
                className="text-input"
                rows={3}
                value={smartInstruction}
                onChange={(event) => setSmartInstruction(event.target.value)}
                placeholder="例如：提取页面中国家与人口数据表；或：总结这篇文章关于销售增长的关键结论"
              />
            </label>
            <label className="field-label">
              <span>生成文件格式</span>
              <select className="text-input" value={smartFormat} onChange={(event) => setSmartFormat(event.target.value as 'csv' | 'md' | 'json')}>
                <option value="csv">CSV（适合表格分析）</option>
                <option value="md">Markdown（适合文档/总结）</option>
                <option value="json">JSON（原始结构）</option>
              </select>
            </label>
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
              <input type="checkbox" checked={smartRenderJs} onChange={(event) => setSmartRenderJs(event.target.checked)} />
              <span>复杂网页启用浏览器渲染（Playwright，失败自动回退）</span>
            </label>
            <div className="actions-row" style={{ gridColumn: '1 / -1' }}>
              <button className="action-button" type="button" disabled={smartBusy} onClick={() => void runSmartScrapePreview()}>
                {smartBusy ? '预览生成中…' : '先预览采集结果'}
              </button>
              {smartPreview ? (
                <>
                  <button
                    className="action-button secondary-button"
                    type="button"
                    disabled={smartBusy}
                    onClick={() => void commitSmartScrape()}
                  >
                    确认导入数据
                  </button>
                  <button
                    className="action-button"
                    type="button"
                    disabled={smartBusy}
                    onClick={() => void commitSmartScrape({ startAnalysis: true })}
                  >
                    确认导入并开始分析
                  </button>
                  <button
                    className="action-button tertiary-button"
                    type="button"
                    disabled={smartBusy}
                    onClick={() => setSmartPreview(null)}
                  >
                    放弃预览
                  </button>
                </>
              ) : null}
            </div>
            {smartPreview ? (
              <div className="flow-alert flow-alert-info" style={{ gridColumn: '1 / -1' }}>
                <strong>采集预览（尚未导入）</strong>
                <p>
                  {smartPreview.message || '请确认内容后导入'}
                  {smartPreview.fileName ? `；文件：${smartPreview.fileName}` : ''}
                  {smartPreview.format ? `（${smartPreview.format}）` : ''}
                  {smartPreview.kind ? `；类型：${smartPreview.kind}` : ''}
                  {smartPreview.strategy ? `；策略：${smartPreview.strategy}` : ''}
                  {typeof smartPreview.byteSize === 'number' ? `；大小：${Math.max(1, Math.round(smartPreview.byteSize / 1024))} KB` : ''}
                </p>
                {smartPreview.kind === 'table' && (smartPreview.availableFields?.length || 0) > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <strong style={{ fontSize: 13 }}>选择要导入的字段</strong>
                    <div className="actions-row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                      <button
                        className="action-button tertiary-button"
                        type="button"
                        onClick={() => setSelectedFields(smartPreview.availableFields || [])}
                      >
                        全选
                      </button>
                      <button className="action-button tertiary-button" type="button" onClick={() => setSelectedFields([])}>
                        清空
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                      {(smartPreview.availableFields || []).map((field) => {
                        const checked = selectedFields.includes(field);
                        return (
                          <label key={field} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setSelectedFields((current) => Array.from(new Set([...current, field])));
                                } else {
                                  setSelectedFields((current) => current.filter((item) => item !== field));
                                }
                              }}
                            />
                            <span>{field}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="status-note" style={{ marginTop: 6 }}>
                      已选 {selectedFields.length}/{(smartPreview.availableFields || []).length} 个字段
                    </p>
                  </div>
                ) : null}
                {Array.isArray(smartPreview.preview) && smartPreview.preview.length > 0 ? (
                  smartPreview.kind === 'table' ? (
                    <div className="smart-preview-table-wrap" style={{ overflowX: 'auto', marginTop: 10 }}>
                      <div className="actions-row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                        <button
                          className="action-button tertiary-button"
                          type="button"
                          onClick={() =>
                            setSelectedRowIndexes(
                              Array.from(
                                { length: Math.min((smartPreview.rows || smartPreview.preview || []).length, 200) },
                                (_, index) => index,
                              ),
                            )
                          }
                        >
                          全选行
                        </button>
                        <button className="action-button tertiary-button" type="button" onClick={() => setSelectedRowIndexes([])}>
                          清空行
                        </button>
                        <span className="status-note">已选 {selectedRowIndexes.length} 行</span>
                      </div>
                      <table className="data-preview-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #dbe3f0' }}>选</th>
                            {(selectedFields.length
                              ? selectedFields
                              : Object.keys((smartPreview.preview[0] as Record<string, unknown>) || {})
                            ).map((key) => (
                              <th key={key} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #dbe3f0' }}>
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {smartPreview.preview.slice(0, 8).map((row, index) => {
                            const checked = selectedRowIndexes.includes(index);
                            return (
                              <tr key={`preview-row-${index}`}>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid #eef2f8' }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setSelectedRowIndexes((current) => Array.from(new Set([...current, index])).sort((a, b) => a - b));
                                      } else {
                                        setSelectedRowIndexes((current) => current.filter((item) => item !== index));
                                      }
                                    }}
                                  />
                                </td>
                                {(selectedFields.length
                                  ? selectedFields
                                  : Object.keys((smartPreview.preview?.[0] as Record<string, unknown>) || {})
                                ).map((key) => (
                                  <td key={`${index}-${key}`} style={{ padding: '6px 8px', borderBottom: '1px solid #eef2f8' }}>
                                    {String((row as Record<string, unknown>)?.[key] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="status-note" style={{ marginTop: 8 }}>
                        仅展示前 {Math.min(8, smartPreview.preview.length)} 行预览
                        {smartPreview.previewCount ? `（共约 ${smartPreview.previewCount} 条）` : ''}。
                        勾选会作用于完整结果集中的对应行号。
                      </p>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          background: 'rgba(255,255,255,0.7)',
                          border: '1px solid #e5edf8',
                          borderRadius: 10,
                          padding: 12,
                          maxHeight: 240,
                          overflow: 'auto',
                          margin: 0,
                        }}
                      >
                        {smartPreview.contentTextPreview ||
                          smartPreview.preview
                            .slice(0, 8)
                            .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
                            .join('\n\n')}
                      </pre>
                    </div>
                  )
                ) : (
                  <p className="status-note" style={{ marginTop: 8 }}>
                    暂无结构化预览，但仍可确认导入生成文件。
                  </p>
                )}              </div>
            ) : null}
            {smartResult ? (
              <div className="flow-alert flow-alert-info" style={{ gridColumn: '1 / -1' }}>
                <strong>已导入结果</strong>
                <p>
                  {smartResult.message || '已完成'}
                  {smartResult.datasetName ? `；数据源：${smartResult.datasetName}` : ''}
                  {smartResult.format ? `；文件：${smartResult.format}` : ''}
                  {smartResult.kind ? `；类型：${smartResult.kind}` : ''}
                  {smartResult.strategy ? `；策略：${smartResult.strategy}` : ''}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="status-note">当前角色为只读，无法执行智能采集。</p>
        )}
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <div>
            <h3>选择文件</h3>
            <p>支持 Excel、CSV、PDF 与常见文档。</p>
          </div>
        </div>
        {writeEnabled ? (
          <DataSourceUploader onImportDataSource={handleImportedDataSource} showPreview />
        ) : (
          <p className="status-note">当前角色为只读，仅可查看与下载已有数据源。</p>
        )}
        {status ? <p className={`status-note status-note-${statusTone}`}>{status}</p> : null}
      </section>

      {lastReadyDataset ? (
        <section className="ops-guide-banner data-source-ready-banner">
          <div>
            <strong>数据已就绪：{lastReadyDataset.name || lastReadyDataset.fileName}</strong>
            <p>下一步：进入说明问题，写一句你想分析什么，然后开始分析。</p>
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
              先去说明问题
            </button>
          </div>
        </section>
      ) : null}

      <section className="content-card workspace-section">
        <div className="section-heading">
          <div>
            <h3>高级：外部数据连接（可选）</h3>
            <p>大多数人只需要上传文件。只有需要网页 / 数据库 / API 时才展开这里。</p>
          </div>
        </div>
        <div className="actions-row" style={{ marginBottom: 12 }}>
          <button
            className="action-button secondary-button"
            type="button"
            onClick={() => setShowAdvancedConnectors((current) => !current)}
          >
            {showAdvancedConnectors ? '收起外部连接' : '展开外部连接'}
          </button>
        </div>
        {showAdvancedConnectors && writeEnabled ? (
          <div className="form-grid">
            <div className="flow-alert flow-alert-info" style={{ gridColumn: '1 / -1' }}>
              <strong>{selectedType?.name || '外部连接说明'}</strong>
              <p>{selectedType?.description || connectorHelp.summary}</p>
              <ul className="workspace-action-rail-tips" style={{ marginTop: 8 }}>
                {connectorHelp.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <p className="status-note" style={{ marginTop: 8 }}>
                推荐流程：填写参数 → 测试当前配置 → 保存连接 → 导入数据集 → 开始分析。
              </p>
            </div>
            <label className="field-label">
              <span>连接名称</span>
              <input
                className="text-input"
                value={connName}
                onChange={(event) => setConnName(event.target.value)}
                placeholder="例如：官网销售表 / 经营报表 API"
              />
              <small className="field-hint">只用于列表识别，可随便起名。</small>
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
              <small className="field-hint">网页 / API / 数据库三选一，按你的数据来源切换。</small>
            </label>
            {connectorType === 'postgres' ? (
              <>
                <label className="field-label">
                  <span>Host（数据库主机）</span>
                  <input className="text-input" value={pgHost} onChange={(event) => setPgHost(event.target.value)} placeholder="127.0.0.1" />
                </label>
                <label className="field-label">
                  <span>Port（端口）</span>
                  <input className="text-input" value={pgPort} onChange={(event) => setPgPort(event.target.value)} placeholder="5432" />
                </label>
                <label className="field-label">
                  <span>Database（库名）</span>
                  <input
                    className="text-input"
                    value={pgDatabase}
                    onChange={(event) => setPgDatabase(event.target.value)}
                    placeholder="analytics"
                  />
                </label>
                <label className="field-label">
                  <span>SQL（只读查询）</span>
                  <input
                    className="text-input"
                    value={pgQuery}
                    onChange={(event) => setPgQuery(event.target.value)}
                    placeholder="select region, sales from sales limit 100"
                  />
                  <small className="field-hint">建议加 LIMIT，避免一次导入过多行。</small>
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
                  <small className="field-hint">优先选择带 HTML 表格的页面；复杂登录页通常抓不到。</small>
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
                  <small className="field-hint">页面有多张表时，1=第一张，2=第二张。</small>
                </label>
                <label className="field-label">
                  <span>Bearer Token（可选）</span>
                  <input
                    className="text-input"
                    type="password"
                    value={bearerToken}
                    onChange={(event) => setBearerToken(event.target.value)}
                    placeholder="一般公开网页不用填"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field-label">
                  <span>接口 URL</span>
                  <input
                    className="text-input"
                    value={httpUrl}
                    onChange={(event) => setHttpUrl(event.target.value)}
                    placeholder="https://api.example.com/metrics"
                  />
                </label>
                <label className="field-label">
                  <span>JSON Path（数组路径）</span>
                  <input
                    className="text-input"
                    value={jsonPath}
                    onChange={(event) => setJsonPath(event.target.value)}
                    placeholder="data.items"
                  />
                  <small className="field-hint">
                    若响应是对象包数组（例如 data.items），就填 data.items；根就是数组可留空。
                  </small>
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
        {showAdvancedConnectors && writeEnabled ? (
          <div className="actions-row">
            <button className="action-button secondary-button" type="button" disabled={draftTesting} onClick={() => void testDraftConnection()}>
              {draftTesting ? '测试中…' : '测试当前配置'}
            </button>
            <button className="action-button" type="button" onClick={() => void createConnection()}>
              保存连接
            </button>
          </div>
        ) : null}

        {showAdvancedConnectors ? (
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
            <EmptyState
              icon="CN"
              title="还没有外部连接"
              description="可先保存 HTTP JSON、网页或 PostgreSQL 连接，再导入为可分析数据集。"
              primaryLabel="滚动到连接表单"
              onPrimary={() => document.querySelector('.data-sources-page .form-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          ) : null}
        </div>
        ) : null}
      </section>

      <section className="content-card workspace-section">
        <div className="section-heading">
          <div>
            <h3>已上传的数据</h3>
            <p>{datasets.length ? `共 ${datasets.length} 份，点“立即开始分析”继续` : '上传后会出现在这里'}</p>
          </div>
        </div>
        {listLoading ? <PageSkeleton title="数据源加载中" description="正在读取已上传数据与连接…" cards={3} rows={3} compact /> : null}
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
                  <button
                    className="action-button secondary-button"
                    type="button"
                    onClick={() => {
                      void withTicketQuery(
                        `${apiBaseUrl}/api/datasets/${dataset.id}/download`,
                        apiBaseUrl,
                        'download',
                      ).then((url) => {
                        window.location.href = url;
                      });
                    }}
                  >
                    下载原文件
                  </button>
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
            <EmptyState
              icon="DS"
              title="还没有可分析数据源"
              description="上传 Excel / CSV / PDF 后，点“立即开始分析”即可继续。"
              primaryLabel={demoLoading ? '准备示例中…' : '一键示例演示'}
              primaryDisabled={!writeEnabled || demoLoading}
              onPrimary={() => {
                if (writeEnabled) void startDemo();
              }}
              secondaryLabel="开始新分析"
              onSecondary={goStartAnalysis}
            />
          ) : null}
        </div>
      </section>

      {activeTask.dataSource ? (
        <section className="content-card workspace-section">
          <div className="section-heading">
          <div>
              <h3>当前用于分析的数据</h3>
              <p>已绑定到工作台会话，可直接继续分析。</p>
            </div>
          </div>
          <div className="workspace-source-summary">
            <strong>{activeTask.dataSource.fileName}</strong>
            <p>{activeTask.status}</p>
          </div>
          <div className="actions-row">
            <button className="action-button" type="button" onClick={goStartAnalysis}>
              去说明问题
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
