
interface ToastProps {
  id: string;
  message: string;
  module?: string;
  onClose(id: string): void;
}

/**
 * Toast — individual toast item.
 * Frosted white · DM Sans body · DM Mono module label.
 * 300ms slide-up via fadeUp keyframe (defined in animations.css).
 * Never focus-grabbing · calm editorial tone.
 */
export function Toast({ id, message, module, onClose }: ToastProps) {
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(20, 20, 15, 0.08)',
        borderRadius: '14px',
        padding: '12px 18px',
        display: 'flex',
        gap: '14px',
        alignItems: 'center',
        minWidth: '280px',
        maxWidth: '480px',
        boxShadow: 'var(--sh-md)',
        animation: 'fadeUp 300ms var(--e-calm-out) both',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {module && (
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '9px',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            whiteSpace: 'nowrap',
          }}
        >
          {module}
        </span>
      )}
      <span
        style={{
          flex: 1,
          fontSize: '13px',
          color: 'var(--ink)',
          lineHeight: 1.4,
        }}
      >
        {message}
      </span>
      <button
        type="button"
        onClick={() => onClose(id)}
        aria-label="close notification"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-faint)',
          cursor: 'pointer',
          fontFamily: "'DM Mono', monospace",
          fontSize: '14px',
          padding: '4px 8px',
          marginLeft: '-6px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
