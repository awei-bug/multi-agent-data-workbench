const payload = {
  name: '2025 经营销售分析',
  status: '样例数据已生成',
  summary:
    '已自动生成 2025 年经营销售样例数据，包含月份、区域、渠道、订单数、销售额、毛利率、投放费用、转化率，可直接启动多 Agent 分析流程。',
  request: '分析 2025 年月度销售额趋势、区域差异、渠道表现和投放效率，并输出管理层报告。',
  dataSource: {
    kind: 'csv',
    fileName: '2025经营销售样例数据.csv',
    columnCount: 8,
    rowCount: 12,
    columns: [
      { name: '月份', type: 'date' },
      { name: '区域', type: 'string' },
      { name: '渠道', type: 'string' },
      { name: '订单数', type: 'number' },
      { name: '销售额', type: 'number' },
      { name: '毛利率', type: 'number' },
      { name: '投放费用', type: 'number' },
      { name: '转化率', type: 'number' },
    ],
    fieldMappings: [
      { source: '月份', target: '月份' },
      { source: '区域', target: '区域' },
      { source: '渠道', target: '渠道' },
      { source: '订单数', target: '订单数' },
      { source: '销售额', target: '销售额' },
      { source: '毛利率', target: '毛利率' },
      { source: '投放费用', target: '投放费用' },
      { source: '转化率', target: '转化率' },
    ],
  },
  snapshot: {
    phase: 'idle',
    logMessage: '样例数据已生成，等待启动多 Agent 流程',
    nodes: [
      { id: 'source', label: '数据接入 Agent', status: 'success' },
      { id: 'clean', label: '数据清洗 Agent', status: 'pending' },
      { id: 'metric', label: '指标计算 Agent', status: 'pending' },
      { id: 'chart', label: '可视化 Agent', status: 'pending' },
      { id: 'analysis', label: '洞察分析 Agent', status: 'pending' },
      { id: 'report', label: '报告生成 Agent', status: 'pending' },
      { id: 'audit', label: '审核校验 Agent', status: 'pending' },
    ],
    context: {
      activeAgent: '数据接入 Agent',
      inputSummary: '已生成 2025 年经营销售样例数据：12 个月、4 个区域、3 类渠道、8 个业务字段。',
      outputSummary: '字段映射已自动确认，可直接进入清洗、指标计算和可视化分析。',
      latestLog: '系统已自动生成可分析样例数据，无需手动上传。',
      risks: ['当前为系统生成样例数据，用于演示流程和图表效果。'],
    },
  },
  risks: ['当前为系统生成样例数据，用于演示流程和图表效果。'],
};

const response = await fetch('http://127.0.0.1:8787/api/active-task', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

const task = await response.json();
console.log(JSON.stringify({ ok: response.ok, name: task.name, status: task.status, fileName: task.dataSource?.fileName }));
