import { createContext, useContext } from 'react';

import { defaultWorkbenchContext, type WorkbenchShellContext as WorkbenchShellState } from '../types/workbench';
import { createEmptyTask } from '../pages/emptyTask';

const noop = () => undefined;

export const WorkbenchShellContext = createContext<WorkbenchShellState>({
  context: defaultWorkbenchContext,
  setContext: noop,
  activeTask: createEmptyTask(),
  setActiveTask: noop,
});

export function useWorkbenchShell() {
  return useContext(WorkbenchShellContext);
}
