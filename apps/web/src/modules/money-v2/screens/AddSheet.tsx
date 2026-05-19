/**
 * money-v2 · AddSheet — a calm bottom-sheet add form
 *
 * The minimal two-field form (name + amount) shared by "add a bill" and
 * "add a subscription". A scrim + a paper sheet rising from the bottom,
 * matching the impulse-pause sheet grammar. Swipe-down / scrim-tap or the
 * quiet "not now" dismisses.
 *
 * Kept deliberately small — the v2 spec gives bills only a name + amount;
 * frequency / due-day default sensibly and are editable later in the live
 * module. This is a preview, not the full bill editor.
 */
import { useState } from 'react';
import { AmberButton, IconCheck, v2 } from '../v2';

export interface AddSheetValue {
  name: string;
  amount: number;
}

export interface AddSheetProps {
  title: string;
  nameLabel: string;
  onSave: (v: AddSheetValue) => void;
  onCancel: () => void;
}

export function AddSheet({ title, nameLabel, onSave, onCancel }: AddSheetProps) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const amt = Number(amount);
  const valid = name.trim().length > 0 && amt > 0;

  const field: React.CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    height: 50,
    borderRadius: 14,
    border: `1px solid ${v2.line}`,
    background: v2.card,
    padding: '0 16px',
    fontSize: 16,
    color: v2.ink,
    fontFamily: v2.sans,
    outline: 'none',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <button
        type="button"
        aria-label="dismiss"
        onClick={onCancel}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(42,38,34,.28)',
          border: 'none',
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-label={title}
        style={{
          position: 'relative',
          background: v2.paper,
          borderRadius: '30px 30px 0 0',
          boxShadow: '0 -20px 50px rgba(42,38,34,.22)',
          padding: '14px 30px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 34px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line, marginBottom: 22 }} />
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.04em',
            marginBottom: 22,
          }}
        >
          {title}
        </div>

        <input
          style={{ ...field, marginBottom: 10 }}
          placeholder={nameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={nameLabel}
        />
        <input
          style={field}
          placeholder="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          aria-label="amount"
        />

        <AmberButton
          block
          icon={<IconCheck size={18} />}
          disabled={!valid}
          onClick={() => valid && onSave({ name: name.trim(), amount: amt })}
          style={{ marginTop: 20, opacity: valid ? 1 : 0.45 }}
        >
          save
        </AmberButton>
        <button
          type="button"
          onClick={onCancel}
          style={{
            marginTop: 14,
            background: 'transparent',
            border: 'none',
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          not now
        </button>
      </div>
    </div>
  );
}
