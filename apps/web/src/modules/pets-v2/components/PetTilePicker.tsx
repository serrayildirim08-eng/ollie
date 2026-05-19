/**
 * pets-v2 · <PetTilePicker> — the "for" pet picker
 *
 * The calm 2-up grid of soft pet tiles from pets-log.html / pets-observe.html:
 * a paw-disc with the pet's initial, the name, and (optionally) the species
 * sub-line. Single-select; the selected tile gets an amber edge. A real
 * <button> per tile, 44px+ hit target.
 */
import { v2 } from '../../money-v2/v2';
import type { StoredPet } from '../selectors';
import { petInitial, speciesLabel } from '../selectors';

export interface PetTilePickerProps {
  pets: StoredPet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** show the species sub-line under the name (log screen) or not (observe) */
  showSpecies?: boolean;
}

const DISC_FILL = '#F2EEDF';

export function PetTilePicker({
  pets,
  selectedId,
  onSelect,
  showSpecies = true,
}: PetTilePickerProps) {
  return (
    <div
      style={{
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 9,
      }}
    >
      {pets.map((pet) => {
        const on = selectedId === pet.id;
        return (
          <button
            key={pet.id}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(pet.id)}
            style={{
              boxSizing: 'border-box',
              minHeight: 62,
              borderRadius: 16,
              border: `1px solid ${on ? v2.accent : v2.line}`,
              background: on ? '#FCF6EA' : v2.card,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 14px',
              boxShadow: on ? 'none' : '0 6px 16px rgba(42,38,34,.04)',
              cursor: 'pointer',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: DISC_FILL,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: v2.ink }}>
                {petInitial(pet)}
              </span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: on ? 600 : 500,
                  letterSpacing: '-0.01em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {pet.name}
              </span>
              {showSpecies && (
                <span style={{ fontSize: 11, color: v2.mute, fontWeight: 500 }}>
                  {speciesLabel(pet.species)}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
