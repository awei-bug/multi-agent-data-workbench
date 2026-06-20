# 多 Agent 数据分析工作台前端 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个基于 React 的可交互前端 MVP，完整跑通数据上传、需求解析、Agent 流程预览、运行监控、人工修正、图表调整、报告编辑与 Word/PDF 导出交互。

**Architecture:** 使用 Vite + React + TypeScript 初始化单页应用，以 Zustand 管理全局状态，以 mock 服务和任务状态机模拟 Agent 链路。UI 采用工作台式布局，将主流程、右侧上下文面板和历史任务视图拆成清晰边界，便于后续替换真实 API 和事件流。

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, Zustand, React Router, ECharts

---

## File Structure

### Create

- `package.json`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `src/styles/global.css`
- `src/styles/theme.css`
- `src/router/index.tsx`
- `src/types/index.ts`
- `src/store/appStore.ts`
- `src/store/taskStore.ts`
- `src/store/dataStore.ts`
- `src/store/artifactStore.ts`
- `src/store/historyStore.ts`
- `src/store/selectors.ts`
- `src/mock/mockData.ts`
- `src/mock/mockTaskEngine.ts`
- `src/mock/mockAgentRunner.ts`
- `src/mock/mockExportService.ts`
- `src/mock/mockTaskRepository.ts`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/SidebarNav.tsx`
- `src/components/layout/Topbar.tsx`
- `src/components/layout/ContextPanel.tsx`
- `src/components/workspace/WorkspaceFlow.tsx`
- `src/components/workspace/StepSwitcher.tsx`
- `src/components/workflow/WorkflowCanvas.tsx`
- `src/components/workflow/ExecutionTimeline.tsx`
- `src/components/data/DataSourceUploader.tsx`
- `src/components/data/SchemaPreview.tsx`
- `src/components/data/EditableDataGrid.tsx`
- `src/components/intent/RequirementComposer.tsx`
- `src/components/intent/IntentSummary.tsx`
- `src/components/charts/ChartBoard.tsx`
- `src/components/report/ReportEditor.tsx`
- `src/components/export/ExportCenter.tsx`
- `src/components/history/HistoryTaskList.tsx`
- `src/pages/WorkspacePage.tsx`
- `src/pages/HistoryPage.tsx`
- `src/utils/filePreview.ts`
- `src/utils/download.ts`
- `src/test/setup.ts`
- `src/test/fixtures.ts`
- `src/mock/mockTaskEngine.test.ts`
- `src/store/taskStore.test.ts`
- `src/components/workspace/WorkspaceFlow.test.tsx`
- `src/components/report/ReportEditor.test.tsx`
- `src/components/export/ExportCenter.test.tsx`

### Modify

- None, current project has no code files

## Task 1: Scaffold The React App

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles/global.css`
- Create: `src/styles/theme.css`
- Test: `src/components/workspace/WorkspaceFlow.test.tsx`

- [ ] **Step 1: Write the failing test for the app shell entry**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '../../App';

describe('App shell', () => {
  it('renders the workspace title and primary navigation', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('多 Agent 数据分析工作台')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建分析任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '历史任务' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: FAIL with module or component missing errors because the project is not scaffolded yet.

- [ ] **Step 3: Write the minimal project scaffold**

```json
{
  "name": "multi-agent-data-workbench",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "echarts": "^5.6.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.2",
    "zustand": "^5.0.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.4.1",
    "jsdom": "^25.0.1",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^2.1.9"
  }
}
```

```tsx
import './styles/global.css';
import './styles/theme.css';

function App() {
  return (
    <div>
      <h1>多 Agent 数据分析工作台</h1>
      <div>
        <button type="button">新建分析任务</button>
        <button type="button">历史任务</button>
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json vite.config.ts index.html src/main.tsx src/App.tsx src/styles/global.css src/styles/theme.css src/components/workspace/WorkspaceFlow.test.tsx
git commit -m "feat: scaffold react frontend mvp"
```

## Task 2: Define Shared Types And Global Stores

**Files:**
- Create: `src/types/index.ts`
- Create: `src/store/appStore.ts`
- Create: `src/store/taskStore.ts`
- Create: `src/store/dataStore.ts`
- Create: `src/store/artifactStore.ts`
- Create: `src/store/historyStore.ts`
- Create: `src/store/selectors.ts`
- Test: `src/store/taskStore.test.ts`

- [ ] **Step 1: Write the failing test for task lifecycle state**

```ts
import { describe, expect, it } from 'vitest';

import { createTaskStore } from './taskStore';

describe('task store', () => {
  it('updates task execution state and current step', () => {
    const store = createTaskStore();

    store.getState().setCurrentStep('workflow');
    store.getState().setExecutionStatus('running');

    expect(store.getState().currentStep).toBe('workflow');
    expect(store.getState().execution.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/store/taskStore.test.ts`
Expected: FAIL because `taskStore.ts` and exported factory do not exist.

- [ ] **Step 3: Write the minimal typed store implementation**

```ts
import { createStore } from 'zustand/vanilla';

export type WorkflowStep =
  | 'source'
  | 'intent'
  | 'workflow'
  | 'execution'
  | 'revision'
  | 'charts'
  | 'report'
  | 'export';

export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'success' | 'warning' | 'failed';

type TaskState = {
  currentStep: WorkflowStep;
  execution: {
    status: ExecutionStatus;
  };
  setCurrentStep: (step: WorkflowStep) => void;
  setExecutionStatus: (status: ExecutionStatus) => void;
};

export function createTaskStore() {
  return createStore<TaskState>((set) => ({
    currentStep: 'source',
    execution: { status: 'idle' },
    setCurrentStep: (currentStep) => set({ currentStep }),
    setExecutionStatus: (status) => set((state) => ({ execution: { ...state.execution, status } })),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/store/taskStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/store/appStore.ts src/store/taskStore.ts src/store/dataStore.ts src/store/artifactStore.ts src/store/historyStore.ts src/store/selectors.ts src/store/taskStore.test.ts
git commit -m "feat: add typed state stores"
```

## Task 3: Build The Workbench Shell And Routing

**Files:**
- Create: `src/router/index.tsx`
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/SidebarNav.tsx`
- Create: `src/components/layout/Topbar.tsx`
- Create: `src/components/layout/ContextPanel.tsx`
- Create: `src/pages/WorkspacePage.tsx`
- Create: `src/pages/HistoryPage.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/workspace/WorkspaceFlow.test.tsx`

- [ ] **Step 1: Write the failing test for routed workbench views**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from '../../App';

describe('workspace navigation', () => {
  it('switches from workspace to history view', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('任务工作区')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByText('历史任务列表')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: FAIL because routed shell and view switching are not implemented.

- [ ] **Step 3: Write the minimal shell and routing code**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import AppShell from '../components/layout/AppShell';
import HistoryPage from '../pages/HistoryPage';
import WorkspacePage from '../pages/WorkspacePage';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/workspace" replace />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

```tsx
import { NavLink, Outlet } from 'react-router-dom';

function AppShell() {
  return (
    <div className="app-shell">
      <aside>
        <h1>多 Agent 数据分析工作台</h1>
        <NavLink to="/workspace">新建分析任务</NavLink>
        <NavLink to="/history">历史任务</NavLink>
      </aside>
      <main>
        <header>任务工作区</header>
        <Outlet />
      </main>
      <section>上下文面板</section>
    </div>
  );
}

export default AppShell;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/router/index.tsx src/components/layout/AppShell.tsx src/components/layout/SidebarNav.tsx src/components/layout/Topbar.tsx src/components/layout/ContextPanel.tsx src/pages/WorkspacePage.tsx src/pages/HistoryPage.tsx src/App.tsx src/components/workspace/WorkspaceFlow.test.tsx
git commit -m "feat: add workbench shell and routing"
```

## Task 4: Implement Mock Data And Task Engine

**Files:**
- Create: `src/mock/mockData.ts`
- Create: `src/mock/mockTaskEngine.ts`
- Create: `src/mock/mockAgentRunner.ts`
- Create: `src/mock/mockTaskRepository.ts`
- Test: `src/mock/mockTaskEngine.test.ts`

- [ ] **Step 1: Write the failing test for sequential agent execution**

```ts
import { describe, expect, it } from 'vitest';

import { createMockTaskEngine } from './mockTaskEngine';

describe('mock task engine', () => {
  it('runs workflow nodes in order and records the final successful node', async () => {
    const engine = createMockTaskEngine();
    const events: string[] = [];

    await engine.run((event) => {
      events.push(`${event.nodeId}:${event.status}`);
    });

    expect(events[0]).toBe('source:running');
    expect(events.at(-1)).toBe('audit:success');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/mock/mockTaskEngine.test.ts`
Expected: FAIL because the engine does not exist.

- [ ] **Step 3: Write the minimal engine and mock workflow data**

```ts
const workflow = ['source', 'clean', 'metrics', 'charts', 'insight', 'report', 'audit'] as const;

export function createMockTaskEngine() {
  return {
    async run(onEvent: (event: { nodeId: string; status: 'running' | 'success' }) => void) {
      for (const nodeId of workflow) {
        onEvent({ nodeId, status: 'running' });
        await Promise.resolve();
        onEvent({ nodeId, status: 'success' });
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/mock/mockTaskEngine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mock/mockData.ts src/mock/mockTaskEngine.ts src/mock/mockAgentRunner.ts src/mock/mockTaskRepository.ts src/mock/mockTaskEngine.test.ts
git commit -m "feat: add mock workflow engine"
```

## Task 5: Implement Source Upload And Requirement Parsing Steps

**Files:**
- Create: `src/components/data/DataSourceUploader.tsx`
- Create: `src/components/data/SchemaPreview.tsx`
- Create: `src/components/intent/RequirementComposer.tsx`
- Create: `src/components/intent/IntentSummary.tsx`
- Create: `src/utils/filePreview.ts`
- Modify: `src/pages/WorkspacePage.tsx`
- Test: `src/components/workspace/WorkspaceFlow.test.tsx`

- [ ] **Step 1: Write the failing test for upload and intent preview**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import WorkspacePage from '../../pages/WorkspacePage';

describe('workspace source and intent steps', () => {
  it('shows parsed analysis intent after submitting a requirement', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await user.type(screen.getByLabelText('分析需求'), '分析 2025 年月度销售额趋势并输出报告');
    await user.click(screen.getByRole('button', { name: '预解析' }));

    expect(screen.getByText('分析目标')).toBeInTheDocument();
    expect(screen.getByText('月度销售额趋势')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: FAIL because source and intent components are not mounted.

- [ ] **Step 3: Write the minimal source and intent components**

```tsx
function RequirementComposer() {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <section>
      <label htmlFor="analysis-request">分析需求</label>
      <textarea id="analysis-request" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="button" onClick={() => setSubmitted(true)}>
        预解析
      </button>
      {submitted ? (
        <div>
          <h2>分析目标</h2>
          <p>月度销售额趋势</p>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/data/DataSourceUploader.tsx src/components/data/SchemaPreview.tsx src/components/intent/RequirementComposer.tsx src/components/intent/IntentSummary.tsx src/utils/filePreview.ts src/pages/WorkspacePage.tsx src/components/workspace/WorkspaceFlow.test.tsx
git commit -m "feat: add source upload and intent parsing steps"
```

## Task 6: Implement Workflow Preview And Execution Monitoring

**Files:**
- Create: `src/components/workflow/WorkflowCanvas.tsx`
- Create: `src/components/workflow/ExecutionTimeline.tsx`
- Create: `src/components/workspace/StepSwitcher.tsx`
- Create: `src/components/workspace/WorkspaceFlow.tsx`
- Modify: `src/components/layout/ContextPanel.tsx`
- Modify: `src/pages/WorkspacePage.tsx`
- Test: `src/components/workspace/WorkspaceFlow.test.tsx`

- [ ] **Step 1: Write the failing test for workflow execution updates**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import WorkspacePage from '../../pages/WorkspacePage';

describe('workflow execution', () => {
  it('starts the workflow and exposes running log entries', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await user.click(screen.getByRole('button', { name: '启动任务' }));

    expect(await screen.findByText('数据接入 Agent 运行中')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: FAIL because workflow preview and execution monitoring are not implemented.

- [ ] **Step 3: Write the minimal workflow and monitoring implementation**

```tsx
function WorkflowCanvas() {
  return (
    <section>
      <h2>Agent 任务流</h2>
      <ul>
        <li>数据接入 Agent</li>
        <li>数据清洗 Agent</li>
        <li>指标计算 Agent</li>
        <li>可视化 Agent</li>
        <li>分析推理 Agent</li>
        <li>报告撰写 Agent</li>
        <li>审核校验 Agent</li>
      </ul>
    </section>
  );
}
```

```tsx
function ExecutionTimeline() {
  const [message, setMessage] = useState('等待执行');

  return (
    <section>
      <button type="button" onClick={() => setMessage('数据接入 Agent 运行中')}>
        启动任务
      </button>
      <p>{message}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/workflow/WorkflowCanvas.tsx src/components/workflow/ExecutionTimeline.tsx src/components/workspace/StepSwitcher.tsx src/components/workspace/WorkspaceFlow.tsx src/components/layout/ContextPanel.tsx src/pages/WorkspacePage.tsx src/components/workspace/WorkspaceFlow.test.tsx
git commit -m "feat: add workflow preview and execution monitoring"
```

## Task 7: Implement Manual Revision And Chart Editing

**Files:**
- Create: `src/components/data/EditableDataGrid.tsx`
- Create: `src/components/charts/ChartBoard.tsx`
- Modify: `src/pages/WorkspacePage.tsx`
- Test: `src/components/workspace/WorkspaceFlow.test.tsx`

- [ ] **Step 1: Write the failing test for manual revision and chart updates**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import WorkspacePage from '../../pages/WorkspacePage';

describe('manual revision and chart board', () => {
  it('applies a data edit and updates chart title settings', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await user.clear(screen.getByLabelText('样例值-0-销售额'));
    await user.type(screen.getByLabelText('样例值-0-销售额'), '3200');
    await user.click(screen.getByRole('button', { name: '应用修改' }));

    await user.clear(screen.getByLabelText('图表标题'));
    await user.type(screen.getByLabelText('图表标题'), '修正后销售趋势');

    expect(screen.getByDisplayValue('修正后销售趋势')).toBeInTheDocument();
    expect(screen.getByText('已标记下游节点重跑')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: FAIL because editable grid and chart configuration UI do not exist.

- [ ] **Step 3: Write the minimal revision and chart editing components**

```tsx
function EditableDataGrid() {
  const [value, setValue] = useState('2800');
  const [applied, setApplied] = useState(false);

  return (
    <section>
      <label htmlFor="sample-cell">样例值-0-销售额</label>
      <input id="sample-cell" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="button" onClick={() => setApplied(true)}>
        应用修改
      </button>
      {applied ? <p>已标记下游节点重跑</p> : null}
    </section>
  );
}
```

```tsx
function ChartBoard() {
  const [title, setTitle] = useState('销售趋势');

  return (
    <section>
      <label htmlFor="chart-title">图表标题</label>
      <input id="chart-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <h3>{title}</h3>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/data/EditableDataGrid.tsx src/components/charts/ChartBoard.tsx src/pages/WorkspacePage.tsx src/components/workspace/WorkspaceFlow.test.tsx
git commit -m "feat: add manual revision and chart editing"
```

## Task 8: Implement Report Editing And Export Flow

**Files:**
- Create: `src/components/report/ReportEditor.tsx`
- Create: `src/components/export/ExportCenter.tsx`
- Create: `src/utils/download.ts`
- Test: `src/components/report/ReportEditor.test.tsx`
- Test: `src/components/export/ExportCenter.test.tsx`

- [ ] **Step 1: Write the failing tests for report editing and export completion**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ReportEditor from './ReportEditor';

describe('report editor', () => {
  it('updates the executive summary text', async () => {
    const user = userEvent.setup();

    render(<ReportEditor />);

    await user.clear(screen.getByLabelText('执行摘要'));
    await user.type(screen.getByLabelText('执行摘要'), '销售额在第二季度显著回升。');

    expect(screen.getByDisplayValue('销售额在第二季度显著回升。')).toBeInTheDocument();
  });
});
```

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ExportCenter from './ExportCenter';

describe('export center', () => {
  it('shows a completed PDF export job', async () => {
    const user = userEvent.setup();

    render(<ExportCenter />);

    await user.click(screen.getByRole('button', { name: '导出 PDF' }));

    expect(await screen.findByText('PDF 导出完成')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/report/ReportEditor.test.tsx src/components/export/ExportCenter.test.tsx`
Expected: FAIL because report and export components do not exist.

- [ ] **Step 3: Write the minimal report editor and export center**

```tsx
function ReportEditor() {
  const [summary, setSummary] = useState('系统将生成分析摘要。');

  return (
    <section>
      <label htmlFor="report-summary">执行摘要</label>
      <textarea id="report-summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
    </section>
  );
}

export default ReportEditor;
```

```tsx
function ExportCenter() {
  const [status, setStatus] = useState('未导出');

  return (
    <section>
      <button type="button" onClick={() => setStatus('PDF 导出完成')}>
        导出 PDF
      </button>
      <p>{status}</p>
    </section>
  );
}

export default ExportCenter;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/report/ReportEditor.test.tsx src/components/export/ExportCenter.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/report/ReportEditor.tsx src/components/export/ExportCenter.tsx src/utils/download.ts src/components/report/ReportEditor.test.tsx src/components/export/ExportCenter.test.tsx
git commit -m "feat: add report editor and export flow"
```

## Task 9: Add History View, Styling Integration, And End-To-End Smoke Coverage

**Files:**
- Create: `src/components/history/HistoryTaskList.tsx`
- Modify: `src/pages/HistoryPage.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/styles/theme.css`
- Modify: `src/pages/WorkspacePage.tsx`
- Test: `src/components/workspace/WorkspaceFlow.test.tsx`

- [ ] **Step 1: Write the failing smoke test for the complete MVP flow**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import WorkspacePage from '../../pages/WorkspacePage';

describe('workspace smoke flow', () => {
  it('walks through parse, run, revise, edit report, and export', async () => {
    const user = userEvent.setup();

    render(<WorkspacePage />);

    await user.type(screen.getByLabelText('分析需求'), '分析 2025 年月度销售额趋势并输出报告');
    await user.click(screen.getByRole('button', { name: '预解析' }));
    await user.click(screen.getByRole('button', { name: '启动任务' }));
    await user.click(screen.getByRole('button', { name: '应用修改' }));
    await user.click(screen.getByRole('button', { name: '导出 PDF' }));

    expect(await screen.findByText('PDF 导出完成')).toBeInTheDocument();
    expect(screen.getByText('月度销售额趋势')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: FAIL because all workflow parts are not yet integrated into one workspace.

- [ ] **Step 3: Integrate the complete workspace and history view**

```tsx
function WorkspacePage() {
  return (
    <div className="workspace-grid">
      <RequirementComposer />
      <IntentSummary />
      <WorkflowCanvas />
      <ExecutionTimeline />
      <EditableDataGrid />
      <ChartBoard />
      <ReportEditor />
      <ExportCenter />
    </div>
  );
}
```

```tsx
function HistoryPage() {
  return (
    <section>
      <h2>历史任务列表</h2>
      <HistoryTaskList />
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/workspace/WorkspaceFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/history/HistoryTaskList.tsx src/pages/HistoryPage.tsx src/styles/global.css src/styles/theme.css src/pages/WorkspacePage.tsx src/components/workspace/WorkspaceFlow.test.tsx
git commit -m "feat: integrate complete frontend mvp flow"
```

## Task 10: Final Verification

**Files:**
- Verify: `package.json`
- Verify: `src/**/*`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS for all Vitest suites with no unexpected warnings.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: PASS and generate a Vite production bundle without TypeScript errors.

- [ ] **Step 3: Run the local app manually**

Run: `npm run dev`
Expected: Local development server starts and the browser shows the full workbench flow.

- [ ] **Step 4: Commit final verification fixes if needed**

```bash
git add package.json src
git commit -m "chore: finalize frontend mvp verification"
```
