import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  durationMs: number;
};

type PushToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastContextValue = {
  toasts: ToastItem[];
  pushToast: (input: PushToastInput) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (input: PushToastInput) => {
      toastSeq += 1;
      const id = `toast-${Date.now()}-${toastSeq}`;
      const item: ToastItem = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'info',
        durationMs: input.durationMs ?? 4200,
      };
      setToasts((current) => [...current.slice(-4), item]);
      if (item.durationMs > 0) {
        window.setTimeout(() => dismissToast(id), item.durationMs);
      }
      return id;
    },
    [dismissToast],
  );

  const clearToasts = useCallback(() => setToasts([]), []);

  const value = useMemo(
    () => ({
      toasts,
      pushToast,
      dismissToast,
      clearToasts,
    }),
    [toasts, pushToast, dismissToast, clearToasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

/** Safe hook for optional usage outside provider (tests / legacy). */
export function useOptionalToast() {
  return useContext(ToastContext);
}
