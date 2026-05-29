/**
 * PhotoIntake · the photo-side of the brain dump.
 *
 * Two surfaces in one file:
 *
 *   1. `usePhotoIntake()` — a hook that owns:
 *        - image state (Blob preview URL + compressed RouteDumpImage)
 *        - drag-over visual flag
 *        - drag/drop, paste, picker handlers
 *      so callers can wire whichever event sources they need.
 *
 *   2. `<PhotoIntakeBar />` — the visual: a quiet camera icon button +
 *      an inline thumbnail with an X. Designed to slot into the existing
 *      BrainDumpInput action row.
 *
 * Editorial spec (read this before tweaking):
 *   - No "Upload Image" label. No icon-in-circle. No drop-shadows.
 *   - Drag-over: 1px dashed sage border on the host container (the host
 *     applies the class itself based on `isDragOver`).
 *   - Thumbnail: 56–64px tall, 1px hairline border, radius 4–6px.
 *   - X glyph: 12px, top-right corner of the thumbnail.
 *   - Camera glyph: stroked 1.5px (matches body type stroke weight),
 *     no fill, currentColor so it inherits ink tone.
 *
 * Errors are surfaced as a quiet inline string on the bar — callers do not
 * need to know about reason codes, the hook formats them.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { colors } from '../theme/tokens';
import { compressImage } from './compressImage';
import type { RouteDumpImage } from '../api';

// ─── reason → quiet copy ─────────────────────────────────────────────────────

function reasonCopy(reason: 'unsupported_mime' | 'too_large' | 'decode_failed'): string {
  switch (reason) {
    case 'unsupported_mime':
      return "This kind of photo isn't supported yet.";
    case 'too_large':
      return 'Photo is too large, try a smaller one.';
    case 'decode_failed':
      return "Couldn't read that photo — try another.";
  }
}

// ─── hook ────────────────────────────────────────────────────────────────────

export interface PhotoIntakeState {
  /** Compressed payload ready to ship in /route/dump. null until selection. */
  image: RouteDumpImage | null;

  /** Local preview URL for the thumbnail. null until selection / after clear. */
  previewUrl: string | null;

  /** Inline error copy. null when no error. */
  error: string | null;

  /** True while the compression pipeline is running. */
  isProcessing: boolean;

  /** True while a dragged file hovers the host. Host renders dashed sage border. */
  isDragOver: boolean;

  /** Clear current image + error. Caller can call after a successful submit. */
  clear: () => void;

  /** Programmatic submission of a Blob (used by all three entry paths). */
  setFile: (blob: Blob) => Promise<void>;

  // ── prebuilt handlers — callers attach to the host element ────────────────
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
}

export function usePhotoIntake(): PhotoIntakeState {
  const [image, setImage] = useState<RouteDumpImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/dragleave fire on children too — counter prevents flicker.
  const dragDepth = useRef(0);

  // Revoke preview URL when it changes or component unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const clear = useCallback(() => {
    setImage(null);
    setError(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const setFile = useCallback(async (blob: Blob) => {
    setError(null);
    setIsProcessing(true);
    try {
      const result = await compressImage(blob);
      if (!result.ok) {
        setError(reasonCopy(result.reason));
        return;
      }
      // swap preview URL atomically — revoke the previous one
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setImage(result.image);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // ── drag/drop ────────────────────────────────────────────────────────────
  const onDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    // Only react if the drag carries files (not text fragments from the page).
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    if (dragDepth.current === 0) setIsDragOver(true);
    dragDepth.current += 1;
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer) return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragOver(false);
      void setFile(file);
    },
    [setFile],
  );

  // ── paste ────────────────────────────────────────────────────────────────
  // Only intercept when the clipboard carries an image. Plain-text paste
  // must fall through to the native textarea handler untouched.
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void setFile(f);
            return;
          }
        }
      }
    },
    [setFile],
  );

  return useMemo(
    () => ({
      image,
      previewUrl,
      error,
      isProcessing,
      isDragOver,
      clear,
      setFile,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
    }),
    [
      image,
      previewUrl,
      error,
      isProcessing,
      isDragOver,
      clear,
      setFile,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
    ],
  );
}

// ─── icon button + thumbnail bar ─────────────────────────────────────────────

export interface PhotoIntakeBarProps {
  intake: PhotoIntakeState;
  /** Disable picker while parent is mid-submit. */
  disabled?: boolean;
}

/**
 * The visual surface: a quiet camera picker button on the left, plus an
 * inline thumbnail + remove X when an image is staged.
 *
 * Inline styles by design — same idiom as NeedsConfirmCard. No CSS module.
 */
export function PhotoIntakeBar({ intake, disabled = false }: PhotoIntakeBarProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void intake.setFile(f);
      // reset so the same file re-selected fires onChange again
      e.target.value = '';
    },
    [intake],
  );

  const buttonStyle: CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 4,
    margin: 0,
    cursor: disabled ? 'default' : 'pointer',
    color: colors.inkFaint,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.4 : 1,
    transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 28,
      }}
    >
      <button
        type="button"
        aria-label="Attach a photo"
        title="Attach a photo"
        onClick={openPicker}
        disabled={disabled || intake.isProcessing}
        style={buttonStyle}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.color = colors.ink;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = colors.inkFaint;
        }}
      >
        <CameraGlyph />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        onChange={onPick}
        style={{ display: 'none' }}
        data-testid="photo-intake-file"
      />

      {intake.previewUrl && (
        <Thumbnail
          url={intake.previewUrl}
          onRemove={intake.clear}
          processing={intake.isProcessing}
        />
      )}

      {intake.isProcessing && !intake.previewUrl && (
        <span
          style={{
            fontFamily: 'inherit',
            fontSize: 13,
            color: colors.inkFaint,
            letterSpacing: '0.04em',
          }}
        >
          reading…
        </span>
      )}

      {intake.error && (
        <span
          role="alert"
          style={{
            fontFamily: 'inherit',
            fontSize: 13,
            color: colors.inkSoft,
            letterSpacing: '0.04em',
          }}
        >
          {intake.error}
        </span>
      )}
    </div>
  );
}

// ─── thumbnail ───────────────────────────────────────────────────────────────

function Thumbnail({
  url,
  onRemove,
  processing,
}: {
  url: string;
  onRemove: () => void;
  processing: boolean;
}): JSX.Element {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 56,
        height: 56,
        borderRadius: 5,
        border: `1px solid ${colors.hairline}`,
        background: colors.paper,
        overflow: 'hidden',
        opacity: processing ? 0.6 : 1,
        transition: 'opacity 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      <img
        src={url}
        alt="Attached photo preview"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
      <button
        type="button"
        aria-label="Remove photo"
        onClick={onRemove}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          padding: 0,
          background: colors.cream,
          color: colors.ink,
          border: `1px solid ${colors.hairline}`,
          borderRadius: 999,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          fontSize: 11,
          fontFamily: 'inherit',
        }}
      >
        <XGlyph />
      </button>
    </span>
  );
}

// ─── glyphs · stroked 1.5px, currentColor, no fill ───────────────────────────

function CameraGlyph(): JSX.Element {
  // Editorial stroke camera, 20px box, 1.5px stroke. Aperture circle + body
  // rect + lens hump. No round-fill, no shadow. Inherits currentColor.
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8h3l1.5-2h9L18 8h3v11H3z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function XGlyph(): JSX.Element {
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2 L10 10 M10 2 L2 10" />
    </svg>
  );
}
