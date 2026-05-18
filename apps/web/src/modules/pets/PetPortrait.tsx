
interface PetPortraitProps {
  species: string;
}

/**
 * Specimen-illustration portrait — hand-drawn SVG silhouette.
 * Guinea pig gets a dedicated illustration; all other species fall back
 * to the generic specimen silhouette. Ink/ember match notebook tokens.
 */
export function PetPortrait({ species }: PetPortraitProps) {
  const ink = 'var(--ink)';
  const ember = 'var(--umber)';

  if (species === 'guinea_pig') {
    return (
      <svg
        viewBox="0 0 88 88"
        aria-hidden="true"
        style={{
          width: 88,
          height: 88,
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        {/* body */}
        <ellipse cx="48" cy="54" rx="26" ry="18" fill="none" stroke={ink} strokeWidth="1.2" />
        {/* head */}
        <ellipse cx="24" cy="46" rx="13" ry="11" fill="none" stroke={ink} strokeWidth="1.2" />
        {/* ear */}
        <ellipse cx="22" cy="38" rx="3.5" ry="2.5" fill="none" stroke={ink} strokeWidth="1.2" transform="rotate(-15 22 38)" />
        {/* eye */}
        <circle cx="18" cy="45" r="1.3" fill={ink} />
        {/* nose — single umber pop */}
        <circle cx="11" cy="49" r="1.4" fill={ember} />
        {/* mouth */}
        <path d="M 11 51 Q 13 53 16 51" stroke={ink} strokeWidth="1" fill="none" />
        {/* fur texture */}
        <path d="M 40 42 Q 50 36 64 42" stroke={ink} strokeWidth="0.6" fill="none" opacity="0.5" />
        <path d="M 38 70 Q 50 76 68 70" stroke={ink} strokeWidth="0.6" fill="none" opacity="0.5" />
        {/* feet */}
        <ellipse cx="36" cy="72" rx="3" ry="1.2" fill="none" stroke={ink} strokeWidth="1" />
        <ellipse cx="62" cy="72" rx="3" ry="1.2" fill="none" stroke={ink} strokeWidth="1" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 88 88"
      aria-hidden="true"
      style={{
        width: 88,
        height: 88,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        flexShrink: 0,
      }}
    >
      <ellipse cx="44" cy="52" rx="30" ry="18" fill="none" stroke={ink} strokeWidth="1.2" opacity="0.4" />
      <circle cx="22" cy="48" r="8" fill="none" stroke={ink} strokeWidth="1.2" opacity="0.4" />
      <circle cx="19" cy="47" r="0.9" fill={ember} opacity="0.7" />
      <text
        x="44" y="78" textAnchor="middle"
        fontFamily="'DM Mono', monospace"
        fontSize="7"
        letterSpacing="0.1em"
        fill="var(--ink-faint)"
      >
        SPECIMEN
      </text>
    </svg>
  );
}
