import { useOptionalToast } from './ToastContext';

function ToastViewport() {
  const toastApi = useOptionalToast();
  if (!toastApi || toastApi.toasts.length === 0) return null;

  return (
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions text">
      {toastApi.toasts.map((toast) => (
        <article key={toast.id} className={`toast-item toast-${toast.tone}`} role="status">
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.description ? <p>{toast.description}</p> : null}
          </div>
          <button
            className="toast-dismiss"
            type="button"
            aria-label="关闭通知"
            onClick={() => toastApi.dismissToast(toast.id)}
          >
            ×
          </button>
        </article>
      ))}
    </div>
  );
}

export default ToastViewport;
