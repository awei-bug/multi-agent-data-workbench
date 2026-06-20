import { createContext, useContext } from 'react';

import { defaultWorkbenchContext, type WorkbenchShellContext as WorkbenchShellState } from '../types/workbench';
import { createMockTaskRepository } from '../mock/mockTaskRepository';

const noop = () => undefined;
const repository = createMockTaskRepository();

export const WorkbenchShellContext = createContext<WorkbenchShellState>({
  context: defaultWorkbenchContext,
  setContext: noop,
  activeTask: repository.getActiveTask(),
  setActiveTask: noop,
});

export function useWorkbenchShell() {
  return useContext(WorkbenchShellContext);
}
