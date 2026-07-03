import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';

function getWorkflowSection() {
  return screen.getByRole('heading', { level: 3, name: 'Agent 任务流预览' }).closest('section') as HTMLElement;
}

function getLogCard() {
  return screen.getByText('运行日志').closest('.log-card') as HTMLElement;
}

function getTimelineSection() {
  return screen.getByRole('heading', { level: 3, name: '运行监控' }).closest('section') as HTMLElement;
}

function getRunningNodeLabel(section: HTMLElement) {
  return section.querySelector('.workflow-node-running strong')?.textContent?.replace(/^\d+\s+/, '') ?? '';
}

function getFailedNodeLabel(section: HTMLElement) {
  return section.querySelector('.workflow-node-failed strong')?.textContent?.replace(/^\d+\s+/, '') ?? '';
}

function switchToExecution() {
  fireEvent.click(screen.getByRole('button', { name: '02 执行编排' }));
}

function prepareRunnableWorkspace() {
  fireEvent.click(screen.getAllByRole('button', { name: '加载示例数据' })[0]);
  switchToExecution();
}

function startTimelineTask() {
  fireEvent.click(within(getTimelineSection()).getByRole('button', { name: '启动任务' }));
}

describe('timed workflow execution', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances the workflow to downstream agents over time', async () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    prepareRunnableWorkspace();
    startTimelineTask();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    const workflowSection = getWorkflowSection();
    const logCard = getLogCard();

    expect(within(workflowSection).getByText('01 数据接入 Agent')).toBeInTheDocument();
    expect(within(workflowSection).getAllByText('已完成').length).toBeGreaterThan(0);
    expect(within(logCard).getByText((content) => content.endsWith(' 执行中'))).toBeInTheDocument();
  });

  it('syncs paused and restarted states into the active task metadata', async () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    prepareRunnableWorkspace();
    startTimelineTask();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    const workflowSection = getWorkflowSection();
    const logCard = getLogCard();
    const pausedNodeLabel = getRunningNodeLabel(workflowSection);

    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    expect(within(logCard).getByText(`已暂停在 ${pausedNodeLabel}`)).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(within(panel).getByText('任务摘要')).toBeInTheDocument();
    expect(within(panel).getByText(`流程暂停在 ${pausedNodeLabel}，等待人工恢复。`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    const topbar = screen.getByRole('heading', { level: 2, name: '多 Agent 主流程' }).closest('.topbar') as HTMLElement;
    expect(within(topbar).getByText('执行中')).toBeInTheDocument();
    expect(within(panel).getByText('已从首节点重新启动执行流程。')).toBeInTheDocument();
  });

  it('syncs failed and stopped states into active task risks and summary', () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    prepareRunnableWorkspace();
    startTimelineTask();
    fireEvent.click(screen.getByRole('button', { name: '模拟失败' }));

    const workflowSection = getWorkflowSection();
    const logCard = getLogCard();
    const failedNodeLabel = getFailedNodeLabel(workflowSection);

    expect(within(workflowSection).getByText(new RegExp(failedNodeLabel))).toBeInTheDocument();
    expect(within(workflowSection).getAllByText('失败').length).toBeGreaterThan(0);
    expect(within(logCard).getByText(`${failedNodeLabel} 执行失败，请检查字段映射后重试。`)).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(within(panel).getByText(`流程在 ${failedNodeLabel} 失败，等待人工处理。`)).toBeInTheDocument();
    expect(within(panel).getByText('当前节点已失败，继续前需要人工确认输入或字段映射。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));

    expect(within(logCard).getByText('任务已终止，中间产物已保留')).toBeInTheDocument();
    expect(within(panel).getByText('任务已终止，保留当前中间产物供人工检查。')).toBeInTheDocument();
  });
});
