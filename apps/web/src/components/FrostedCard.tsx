import React from 'react';

interface FrostedCardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  as?: 'div' | 'section';
}

/**
 * FrostedCard — canonical frosted-glass card treatment from void.
 * rgba(255,255,255,0.6) bg · blur(16px) · 1px border · 20px radius.
 * Uses token values where available (--sh-md, --rule-soft).
 */
export function FrostedCard({
  children,
  style,
  className,
  as: Tag = 'div',
}: FrostedCardProps) {
  return (
    <Tag
      className={className}
      style={{
        background: 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.25)',
        borderRadius: '20px',
        boxShadow: 'var(--sh-md)',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
