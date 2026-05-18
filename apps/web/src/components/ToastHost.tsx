import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { useToastState } from './ToastContext';

/**
 * ToastHost — mounts at App root.
 * Portals toast stack to document.body · fixed bottom-center.
 * Reads from ToastContext; never holds its own state.
 */
export function ToastHost() {
  const { toasts, close } = useToastState();

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: '100px',
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: '10px',
        alignItems: 'center',
        zIndex: 500,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} message={t.message} module={t.module} onClose={close} />
      ))}
    </div>,
    document.body,
  );
}
