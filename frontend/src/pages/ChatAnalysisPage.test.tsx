import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { WorkbenchShellContext } from '../context/WorkbenchShellContext';
import { defaultWorkbenchContext } from '../types/workbench';
import ChatAnalysisPage from './ChatAnalysisPage';
import { createEmptyTask } from './emptyTask';

describe('document analysis view', () => {
  it('shows document insights instead of requiring csv fields', () => {
    const task = {
      ...createEmptyTask(),
      name: '文档分析任务',
      dataSource: {
        kind: 'document' as const,
        fileName: 'brief.docx',
        columnCount: 0,
        rowCount: 2,
        fieldMappings: [],
        textPreview: '第一段结论\n第二段行动项',
        profile: {
          charCount: 12,
          paragraphCount: 2,
          keywords: [{ term: '结论', count: 2 }, { term: '行动', count: 1 }],
        },
      },
      artifacts: [
        {
          type: 'metric_result',
          content: {
            analysisMode: 'document',
            groups: [{ name: '结论', value: 2 }, { name: '行动', value: 1 }],
          },
        },
        {
          type: 'analysis',
          content: {
            analysisMode: 'document',
            summary: '文档重点围绕结论和行动展开。',
            evidence: {
              evidence: [{ text: '第一段结论' }, { text: '第二段行动项' }],
              keywords: [{ term: '结论', count: 2 }, { term: '行动', count: 1 }],
            },
          },
        },
      ],
    };

    render(
      <MemoryRouter>
        <WorkbenchShellContext.Provider
          value={{ context: defaultWorkbenchContext, setContext: () => undefined, activeTask: task, setActiveTask: () => undefined }}
        >
          <ChatAnalysisPage />
        </WorkbenchShellContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '文档洞察', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('文档重点围绕结论和行动展开。')).toBeInTheDocument();
    expect(screen.getByText('结论：2')).toBeInTheDocument();
    expect(screen.getByText('第一段结论')).toBeInTheDocument();
  });
});
