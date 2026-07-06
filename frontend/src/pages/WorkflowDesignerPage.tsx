import { useState } from 'react';

import { createMockTaskRepository } from '../mock/mockTaskRepository';

const agents = ['调度 Agent', '数据清洗 Agent', '统计分析 Agent', '可视化 Agent', '报告撰写 Agent', '审核校验 Agent'];
const repository = createMockTaskRepository();

function WorkflowDesignerPage() {
  const [canvasAgents, setCanvasAgents] = useState(agents.slice(0, 4));
  const [selectedAgent, setSelectedAgent] = useState(canvasAgents[0]);
  const [status, setStatus] = useState('等待选择或保存流程模板');
  const templates = repository.listTemplates();
  const addAgent = (agent: string) => {
    setCanvasAgents((current) => (current.includes(agent) ? current : [...current, agent]));
    setSelectedAgent(agent);
  };

  return (
    <div className="workflow-designer">
      <section className="content-card workspace-section node-library">
        <div className="section-heading">
          <span className="section-index">NL</span>
          <div>
            <h3>组件库</h3>
            <p>选择 Agent 节点、判断分支和导出节点。</p>
          </div>
        </div>
        <div className="workflow-list">
          {agents.map((agent) => (
            <button
              className="sidebar-link workflow-palette-item"
              draggable
              type="button"
              key={agent}
              onClick={() => addAgent(agent)}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', agent)}
            >
              {agent}
            </button>
          ))}
        </div>
      </section>

      <section className="content-card workspace-section workflow-canvas-panel">
        <div className="section-heading">
          <span className="section-index">WF</span>
          <div>
            <h3>工作流画布</h3>
            <p>以流程图方式查看 Agent 执行顺序、依赖关系和当前进度。</p>
          </div>
        </div>
        <div className="actions-row workflow-template-bar">
          <select
            className="text-input"
            aria-label="选择流程模板"
            defaultValue=""
            onChange={(event) => {
              const template = templates.find((item) => item.id === event.target.value);
              if (!template) return;
              setCanvasAgents(agents);
              setSelectedAgent(agents[0]);
              setStatus(`已加载模板：${template.name}`);
            }}
          >
            <option value="" disabled>
              选择流程模板
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <span className="status-note">{status}</span>
        </div>
        <div
          className="workflow-board"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addAgent(event.dataTransfer.getData('text/plain'));
          }}
        >
          {canvasAgents.map((agent, index) => (
            <article
              className={`workflow-node workflow-node-${index === 0 ? 'running' : index < 3 ? 'success' : 'pending'}`}
              key={agent}
              onClick={() => setSelectedAgent(agent)}
            >
              <div>
                <strong>{`${String(index + 1).padStart(2, '0')} ${agent}`}</strong>
                <p className="status-note">{index === 0 ? '正在调度' : index < 3 ? '已完成' : '待执行'}</p>
              </div>
              <span className={`status-chip status-chip-${index === 0 ? 'running' : index < 3 ? 'success' : 'pending'}`}>
                {index === 0 ? '运行中' : index < 3 ? '完成' : '等待'}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="content-card workspace-section node-config-panel">
        <div className="section-heading">
          <span className="section-index">CF</span>
          <div>
            <h3>节点配置</h3>
            <p>配置当前选中 Agent 的参数、输入输出和执行规则。</p>
          </div>
        </div>
        <label className="field-label" htmlFor="node-goal">
          {selectedAgent} 输出要求
        </label>
        <textarea id="node-goal" className="text-input text-area" defaultValue="输出清洗规则、异常字段说明和后续指标计算输入。" />
        <div className="actions-row">
          <button className="action-button" type="button" onClick={() => setStatus(`已保存模板：${selectedAgent} 流程`)}>
            保存流程模板
          </button>
        </div>
      </section>
    </div>
  );
}

export default WorkflowDesignerPage;
