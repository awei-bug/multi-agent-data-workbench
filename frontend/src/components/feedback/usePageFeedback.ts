import { useCallback, useState } from 'react';

import { useOptionalToast, type ToastTone } from './ToastContext';

export type FeedbackTone = ToastTone;

export function usePageFeedback(initialStatus = '') {
  const toastApi = useOptionalToast();
  const [status, setStatusState] = useState(initialStatus);
  const [statusTone, setStatusTone] = useState<FeedbackTone>('info');

  const clearStatus = useCallback(() => {
    setStatusState('');
    setStatusTone('info');
  }, []);

  const setStatus = useCallback((message: string, tone: FeedbackTone = 'info') => {
    setStatusState(message);
    setStatusTone(tone);
  }, []);

  const notify = useCallback(
    (
      title: string,
      options?: {
        description?: string;
        tone?: FeedbackTone;
        keepStatus?: boolean;
        durationMs?: number;
      },
    ) => {
      const tone = options?.tone ?? 'info';
      if (options?.keepStatus !== false) {
        setStatusState(options?.description ? `${title} ${options.description}` : title);
        setStatusTone(tone);
      }
      toastApi?.pushToast({
        title,
        description: options?.description,
        tone,
        durationMs: options?.durationMs,
      });
    },
    [toastApi],
  );

  return {
    status,
    statusTone,
    setStatus,
    clearStatus,
    notify,
  };
}
