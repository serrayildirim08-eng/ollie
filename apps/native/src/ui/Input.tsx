import type { InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "password" | "search" | "tel" | "url" | "number";
  disabled?: boolean;
  error?: string;
  /** Accessible label — rendered visually hidden if you pass labelHidden. */
  label?: string;
  labelHidden?: boolean;
  id?: string;
}

let _idCounter = 0;

/**
 * Ollie Input — editorial bottom-border style.
 * onChange fires with the string value directly, not the event.
 */
export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  error,
  label,
  labelHidden = false,
  id,
  className,
  ...rest
}: InputProps) {
  // Stable id for a11y without useId (React 18+). Fallback for SSR safety.
  const inputId = id ?? `ollie-input-${++_idCounter}`;

  const inputCls = [
    styles.input,
    error ? styles.inputError : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.wrapper}>
      {label && (
        <label
          htmlFor={inputId}
          className={styles.errorMsg} /* reuses caption style */
          style={labelHidden ? { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" } : undefined}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={inputCls}
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...rest}
      />
      {error && (
        <span id={`${inputId}-error`} className={styles.errorMsg} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
