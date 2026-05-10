/**
 * @ollie/logic · pets guilt-copy
 *
 * generateGuiltTripCopy — dry, deadpan VOID-voice notification text.
 * Pure: no I/O, no clock reads.
 */

import type { CareGap, Pet, SpeciesProfile, GuiltCopy } from './types';
import { TASK_DISPLAY } from './constants';

/**
 * Generate a human-readable copy string for a care gap.
 * Returns `{ level: 'ok', text: '' }` when no action is needed.
 */
export function generateGuiltTripCopy(
  careGap: CareGap | undefined | null,
  pet: Pet | undefined | null,
  speciesProfile: SpeciesProfile | undefined | null,
): GuiltCopy {
  if (!careGap || !pet || !speciesProfile) return { level: 'ok', text: '' };
  const level = careGap.severity;
  if (!level || level === 'ok') return { level: 'ok', text: '' };

  const petName = (pet.name ?? '').toLowerCase();
  const taskDisplay =
    TASK_DISPLAY[careGap.task] ?? (careGap.task ?? '').replace(/_/g, ' ');
  const taskProfile = (speciesProfile.care_tasks ?? {})[careGap.task] ?? {};
  const cadence = taskProfile.cadence_days;
  const welfareNote = taskProfile.welfare_note;
  const days = careGap.days_since === null ? '?' : Math.floor(careGap.days_since);

  let text = '';
  switch (level) {
    case 'nudge':
      text = `${taskDisplay} for ${petName} is coming due.`;
      break;
    case 'soft':
      text = `${taskDisplay} for ${petName} is overdue. been ${days} days.`;
      break;
    case 'firm':
      text = `${petName}'s ${taskDisplay} is ${days} days late. the cadence is every ${cadence}.`;
      break;
    case 'concerned':
      text = `${petName} has gone ${days} days without ${taskDisplay}.`;
      if (welfareNote) text += ' ' + welfareNote;
      break;
    default:
      text = '';
  }
  return { level, text };
}
