/**
 * money-v2 · ImpulsePauseScreen — the pause sheet (money-impulse-pause.html)
 *
 * An OFFER, not a block. The sheet rises over a dimmed spend screen. The
 * tone is neutral: no praise for waiting, no push to buy — just a
 * question and two equal targets.
 *
 * In the preview this is reached when LogSpendScreen sees a spend at or
 * above IMPULSE_THRESHOLD. "hold 24h" and "spend it now" both just
 * dismiss back — the preview does not persist a hold queue (the live
 * module's ImpulsePauseModal owns the real `finance.pendingPauses`
 * slice; wiring it through the preview is out of scope and noted in the
 * report).
 */
import { GhostButton, AmberButton, IconClock, v2 } from '../v2';

export interface ImpulsePauseScreenProps {
  onBack: () => void;
}

export function ImpulsePauseScreen({ onBack }: ImpulsePauseScreenProps) {
  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* the spend screen behind, dimmed */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.35,
          filter: 'blur(2px)',
        }}
      >
        <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500 }}>spent</div>
        <div style={{ fontSize: 80, fontWeight: 300, color: v2.ink, letterSpacing: '-0.04em' }}>
          <span style={{ color: v2.mute, fontSize: 48 }}>$</span>180
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(42,38,34,.28)' }} />

      {/* the sheet */}
      <div
        role="dialog"
        aria-label="impulse pause"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
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
        <button
          type="button"
          aria-label="dismiss"
          onClick={onBack}
          style={{
            width: 38,
            height: 5,
            borderRadius: 3,
            background: v2.line,
            border: 'none',
            marginBottom: 26,
            cursor: 'pointer',
            padding: 0,
          }}
        />
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: '50%',
            background: v2.tile,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <IconClock stroke={v2.sage} />
        </div>

        <div
          style={{
            fontSize: 24,
            fontWeight: 400,
            color: v2.ink,
            letterSpacing: '-0.015em',
            textAlign: 'center',
          }}
        >
          $180 · headphones
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 15,
            lineHeight: 1.5,
            color: v2.sage,
            fontWeight: 500,
            textAlign: 'center',
            maxWidth: 270,
          }}
        >
          this looks like the speaker you almost bought last week.
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 17,
            color: v2.ink,
            fontWeight: 500,
            textAlign: 'center',
            letterSpacing: '-0.01em',
          }}
        >
          hold it 24 hours?
        </div>

        <div
          style={{
            marginTop: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            width: '100%',
          }}
        >
          <AmberButton
            block
            icon={<IconClock size={16} weight={2} />}
            onClick={onBack}
          >
            hold 24h
          </AmberButton>
          <GhostButton onClick={onBack}>spend it now</GhostButton>
        </div>

        <div
          style={{
            marginTop: 20,
            fontSize: 12,
            color: v2.mute,
            fontWeight: 500,
            textAlign: 'center',
          }}
        >
          an offer, not a block · turn off in settings
        </div>
      </div>
    </div>
  );
}
