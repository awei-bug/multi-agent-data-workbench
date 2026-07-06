import { useState } from 'react';

function ChatAnalysisPage() {
  const [draft, setDraft] = useState('请基于当前数据集，找出销售增长最快的区域并生成报告摘要。');
  const [focusedPreview, setFocusedPreview] = useState('实时结果预览');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: '用户', text: '分析 2025 年月度销售趋势，并输出管理层摘要。' },
    { role: '调度 Agent', text: '已拆分为数据清洗、指标计算、可视化、洞察分析、报告生成五个子任务。' },
    { role: '统计分析 Agent', text: '销售额整体上升，华东区域贡献最高，6 月后增长斜率变大。' },
    { role: '报告撰写 Agent', text: '已形成趋势判断、区域贡献、风险提示和建议动作。' },
  ]);

  const sendMessage = () => {
    if (!draft.trim()) return;
    setMessages((current) => [
      ...current,
      { role: '用户', text: draft.trim() },
      { role: '调度 Agent', text: '已接收新需求，正在重新编排清洗、分析、可视化和报告任务。' },
    ]);
    setDraft('');
  };

  const applyTemplate = (value: string) => {
    setDraft(value);
  };

  return (
    <div className="workspace-grid chat-page chat-page-focused">
      <section className="content-card workspace-section chat-main">
        <div className="section-heading">
          <span className="section-index">CA</span>
          <div>
            <h3>对话分析</h3>
            <p>用自然语言发起分析，查看各 Agent 的阶段性回复和最终结论。</p>
          </div>
        </div>
        <div className="chat-stream">
          {messages.map((message, index) => (
            <article
              className={`chat-bubble chat-bubble-${message.role.includes('用户') ? 'user' : 'agent'}`}
              key={`${message.role}-${index}`}
              onClick={() => setFocusedPreview(`${message.role} 结果预览`)}
            >
              <strong>{message.role}</strong>
              <p>{message.text}</p>
            </article>
          ))}
        </div>
        <div className="chat-input-panel">
          <div className="actions-row">
            <button className="action-button tertiary-button" type="button" onClick={() => applyTemplate('按月份复盘销售额、订单数和客单价变化。')}>
              月度复盘
            </button>
            <button className="action-button tertiary-button" type="button" onClick={() => applyTemplate('按渠道拆解 ROI、转化率和异常波动原因。')}>
              渠道分析
            </button>
          </div>
          <textarea className="text-input text-area" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="actions-row">
            <button className="action-button" type="button" onClick={sendMessage}>
              启动多 Agent 协同
            </button>
            <button className="action-button secondary-button" type="button">
              上传数据集
            </button>
            <button className="action-button secondary-button" type="button">
              终止任务
            </button>
            <button className="action-button secondary-button" type="button" onClick={() => setPreviewOpen((current) => !current)}>
              {previewOpen ? '收起实时结果' : '展开实时结果'}
            </button>
          </div>
        </div>
      </section>

      <section className={`content-card workspace-section chat-preview-drawer${previewOpen ? ' open' : ''}`}>
        <div className="section-heading">
          <span className="section-index">PR</span>
          <div>
            <h3>{focusedPreview}</h3>
            <p>点击 Agent 对话气泡后，这里会切换到对应预览。</p>
          </div>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>数据预览</span>
            <strong>12 月 / 3 区域 / 销售额</strong>
          </div>
          <div className="summary-card">
            <span>图表预览</span>
            <strong>趋势图、柱状图、饼图</strong>
          </div>
          <div className="summary-card">
            <span>片段洞察</span>
            <strong>华东区域连续领先</strong>
          </div>
          <div className="summary-card">
            <span>完整报告</span>
            <strong>等待确认后导出</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ChatAnalysisPage;
