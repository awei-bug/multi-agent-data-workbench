import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../App';

function getWorkflowSection() {
  return screen.getByRole('heading', { level: 3, name: 'Agent 任务流预览' }).closest('section') as HTMLElement;
}

function getLogCard() {
  return screen.getByText('当前日志').closest('.log-card') as HTMLElement;
}

function getRunningNodeLabel(section: HTMLElement) {
  const runningEntry = within(section).getByText((content) => content.endsWith(' 运行中'));
  return runningEntry.textContent?.replace(' 运行中', '') ?? '';
}

function getFailedNodeLabel(section: HTMLElement) {
  const failedEntry = within(section).getByText((content) => content.endsWith(' 执行失败'));
  return failedEntry.textContent?.replace(' 执行失败', '') ?? '';
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

    fireEvent.click(screen.getByRole('button', { name: '启动任务' }));

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    const workflowSection = getWorkflowSection();
    const logCard = getLogCard();

    expect(within(workflowSection).getByText('数据接入 Agent 已完成')).toBeInTheDocument();
    expect(within(logCard).getByText((content) => content.endsWith(' 运行中'))).toBeInTheDocument();
  });

  it('syncs paused and restarted states into the active task metadata', async () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '启动任务' }));

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

    fireEvent.click(screen.getByRole('button', { name: '启动任务' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟失败' }));

    const workflowSection = getWorkflowSection();
    const logCard = getLogCard();
    const failedNodeLabel = getFailedNodeLabel(workflowSection);

    expect(within(workflowSection).getByText(`${failedNodeLabel} 执行失败`)).toBeInTheDocument();
    expect(within(logCard).getByText(`${failedNodeLabel} 执行失败，请检查字段映射后重试`)).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: '上下文面板' });
    expect(within(panel).getByText(`流程在 ${failedNodeLabel} 失败，等待人工处理。`)).toBeInTheDocument();
    expect(within(panel).getByText('当前节点执行失败，需人工确认输入口径或字段映射后再继续。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));

    expect(within(logCard).getByText('任务已终止，保留当前中间产物供人工检查')).toBeInTheDocument();
    expect(within(panel).getByText('任务已终止，保留当前中间产物供人工检查。')).toBeInTheDocument();
  });
});
