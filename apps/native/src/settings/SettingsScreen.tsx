/**
 * SettingsScreen — account + trust layer (report §F).
 *
 * Was a stub (email + sign out). Now also carries the launch-critical trust
 * controls: a plain-language privacy note, a data export, and account deletion.
 * Kept deliberately small — no preference sprawl, no module marketplace.
 *
 * Honesty notes:
 *   - the privacy copy describes what the code actually does (local encrypted
 *     DB, PII stripped before the AI call). No claims the build can't back.
 *   - delete calls the apps/api worker; when that worker isn't configured in
 *     the build, the button says so instead of pretending (deleteAccount.ts).
 *   - export hands a JSON file to the webview download; verify on device.
 */

import { useState } from 'react';
import { useUser, useClerk, useAuth } from '@clerk/clerk-react';
import { Stack, Row, Box } from '../layout';
import { Text } from '../ui';
import { colors, radii, shadows } from '../theme/tokens';
import { buildExportJson, exportFilename, triggerDownload } from './exportData';
import { deleteAccount } from './deleteAccount';

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ollie-font-sans)',
  fontSize: '26px',
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
};

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

/** A full-width cream action button matching the room-card idiom. */
function ActionButton({
  label,
  onClick,
  disabled = false,
  tone = 'sage',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'sage' | 'amber' | 'faint';
}): JSX.Element {
  const color =
    tone === 'amber' ? colors.amber : tone === 'faint' ? colors.inkFaint : colors.sageDeep;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '16px 18px',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        borderRadius: radii.card,
        background: colors.cream,
        boxShadow: shadows.raised,
        cursor: disabled ? 'default' : 'pointer',
        color,
        opacity: disabled ? 0.5 : 1,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 14,
        fontFamily: 'var(--ollie-font-sans)',
      }}
    >
      {label}
    </button>
  );
}

export function SettingsScreen(): JSX.Element {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();

  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onExport = async () => {
    setExportStatus('preparing…');
    try {
      const json = await buildExportJson();
      triggerDownload(json, exportFilename());
      setExportStatus('your data is on its way to your files.');
    } catch {
      setExportStatus('could not export just now. try again.');
    }
  };

  const onConfirmDelete = async () => {
    setDeleteStep('deleting');
    setDeleteError(null);
    const res = await deleteAccount(() => getToken());
    if (res.ok) {
      await signOut();
      return;
    }
    setDeleteError(res.message);
    setDeleteStep('idle');
  };

  return (
    <Stack gap={32}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          settings
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>
          settings
        </Text>
      </Stack>

      {/* account */}
      <Stack gap={12}>
        <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
          <Row gap={12} align="center" justify="space-between">
            <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
              account
            </Text>
            <Text scale="body">{user?.primaryEmailAddress?.emailAddress ?? '—'}</Text>
          </Row>
        </Box>
      </Stack>

      {/* privacy — plain language, true to the code */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          your privacy
        </Text>
        <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
          <Stack gap={10}>
            <Text scale="body" color={colors.inkSoft} style={{ lineHeight: 1.5 }}>
              your data lives on your device, in an encrypted database.
            </Text>
            <Text scale="body" color={colors.inkSoft} style={{ lineHeight: 1.5 }}>
              to sort a dump, the words go to an ai service after personal
              details like names and numbers are stripped out.
            </Text>
            <Text scale="body" color={colors.inkSoft} style={{ lineHeight: 1.5 }}>
              no ads. no selling your data. no streaks.
            </Text>
          </Stack>
        </Box>
      </Stack>

      {/* your data — export */}
      <Stack gap={10}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          your data
        </Text>
        <ActionButton label="download my data" onClick={() => void onExport()} />
        {exportStatus && (
          <Text scale="caption" color={colors.inkFaint} style={{ paddingLeft: 2 }}>
            {exportStatus}
          </Text>
        )}
      </Stack>

      {/* danger — delete, with an inline two-step confirm (no modal) */}
      <Stack gap={10}>
        {deleteStep === 'idle' && (
          <ActionButton label="delete my account" tone="amber" onClick={() => setDeleteStep('confirm')} />
        )}
        {deleteStep === 'confirm' && (
          <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
            <Stack gap={12}>
              <Text scale="body" color={colors.ink} style={{ lineHeight: 1.5 }}>
                this erases everything, for good. there is no undo.
              </Text>
              <Row gap={24} align="center">
                <button
                  type="button"
                  onClick={() => void onConfirmDelete()}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: colors.amber,
                    fontWeight: 600,
                    fontSize: 14,
                    fontVariantCaps: 'all-small-caps',
                    letterSpacing: '0.08em',
                  }}
                >
                  delete forever
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteStep('idle')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: colors.inkFaint,
                    fontSize: 14,
                    fontVariantCaps: 'all-small-caps',
                    letterSpacing: '0.08em',
                  }}
                >
                  keep my account
                </button>
              </Row>
            </Stack>
          </Box>
        )}
        {deleteStep === 'deleting' && (
          <Text scale="caption" color={colors.inkFaint} style={{ paddingLeft: 2 }}>
            deleting…
          </Text>
        )}
        {deleteError && (
          <Text scale="caption" color={colors.inkFaint} style={{ paddingLeft: 2 }}>
            {deleteError}
          </Text>
        )}
      </Stack>

      {/* sign out */}
      <ActionButton label="sign out" tone="sage" onClick={() => void signOut()} />
    </Stack>
  );
}
