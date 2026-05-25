import { useRef, useEffect, type TextareaHTMLAttributes } from "react";
import styles from "./Textarea.module.css";

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  label?: string;
  labelHidden?: boolean;
  id?: string;
  /** Min visible rows before auto-grow kicks in. Default 3. */
  minRows?: number;
}

let _idCounter = 0;

/**
 * Ollie Textarea — brain-dump input with auto-grow.
 * Uses `field-sizing: content` (CSS) with a JS fallback for older WebViews.
 * onChange fires with the string value directly.
 */
export function Textarea({
  value,
  onChange,
  placeholder,
  disabled = false,
  error,
  label,
  labelHidden = false,
  id,
  minRows = 3,
  className,
  style,
  ...rest
}: TextareaProps) {
  const textareaId = id ?? `ollie-textarea-${++_idCounter}`;
  const ref = useRef<HTMLTextAreaElement>(null);

  // JS auto-grow fallback for browsers without field-sizing:content support.
  // Chromium 123+ has it; Tauri WebView may lag. This handles both.
  function grow() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    grow();
  }, [value]);

  const textareaCls = [
    styles.textarea,
    error ? styles.textareaError : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.wrapper}>
      {label && (
        <label
          htmlFor={textareaId}
          className={styles.errorMsg}
          style={
            labelHidden
              ? {
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  clip: "rect(0,0,0,0)",
                  whiteSpace: "nowrap",
                }
              : undefined
          }
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={textareaCls}
        value={value}
        onChange={
          onChange
            ? (e) => {
                grow();
                onChange(e.target.value);
              }
            : grow
        }
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${textareaId}-error` : undefined}
        style={style}
        {...rest}
      />
      {error && (
        <span
          id={`${textareaId}-error`}
          className={styles.errorMsg}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
