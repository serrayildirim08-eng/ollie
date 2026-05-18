import type { CareLogEntry } from '@ollie/logic/pets';

interface PetCareStripProps {
  petId: string;
  careLog: CareLogEntry[];
  tasks: string[];
  now: number;
  dotCount?: number;
}

/**
 * 30-day care history as a row of filled/empty dots.
 * Filled = any care task logged on that day. Empty = no care.
 */
export function PetCareStrip({ petId, careLog, tasks, now, dotCount = 30 }: PetCareStripProps) {
  const dayMs = 86_400_000;
  const today = Math.floor(now / dayMs);

  const dots: Array<{ i: number; hit: boolean }> = [];
  for (let i = dotCount - 1; i >= 0; i--) {
    const day = today - i;
    const dayStart = day * dayMs;
    const dayEnd = dayStart + dayMs;
    const hit = careLog.some(
      (e) =>
        e.pet_id === petId &&
        tasks.includes(e.task) &&
        e.occurred_at >= dayStart &&
        e.occurred_at < dayEnd,
    );
    dots.push({ i, hit });
  }

  return (
    <div
      style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', marginBottom: 24 }}
      aria-label={`care history, last ${dotCount} days`}
    >
      {dots.map((d) => (
        <span
          key={`${petId}-${d.i}`}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background: d.hit ? 'var(--ink)' : 'transparent',
            border: d.hit ? 'none' : '1px solid var(--rule)',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  );
}
