type AsyncBridgeState = {
  status: 'idle' | 'pending' | 'success' | 'error';
  errorMessage: string | null;
};

export function createWorkspaceSessionAsyncBridge() {
  let state: AsyncBridgeState = {
    status: 'idle',
    errorMessage: null,
  };

  return {
    getState() {
      return state;
    },
    async run<T>(action: () => Promise<T>) {
      state = {
        status: 'pending',
        errorMessage: null,
      };

      try {
        const result = await action();
        state = {
          status: 'success',
          errorMessage: null,
        };

        return result;
      } catch (error) {
        state = {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'unknown error',
        };

        throw error;
      }
    },
    reset() {
      state = {
        status: 'idle',
        errorMessage: null,
      };
    },
  };
}
