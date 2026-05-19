/**
 * V2ShellPreviewScreen — the assembled clean-slate v2 app
 *
 * Mounted at `/preview/v2` (hash route `index.html#/preview/v2`). This is
 * the COMPLETE navigable v2 experience — the SHELL that ties all 12 v2
 * modules into one app: capture deck → 4 modules → module homepages →
 * submodules, with Find and Safe everywhere. This is what Serra opens on
 * her iPhone to use the whole new design.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the 12 single
 * `/preview/{module}` routes) so it is reachable directly without going
 * through onboarding. It is additive: the live app, its `GatedLayout`, and
 * the 12 individual `/preview/*` routes are all untouched.
 *
 * `onThrow` is wired to the REAL brain-dump pipeline (`applyDump`) so a
 * thrown thought is really routed and stored — the shell shows Serra's
 * real data and anything captured here is real.
 */
import { ShellApp } from '../modules/v2-shell';
import { useAppServices } from '../app-services';

export interface V2ShellPreviewScreenProps {
  /** open the crisis surface from the Safe dot (the router passes /crisis) */
  onSafe: () => void;
}

export function V2ShellPreviewScreen({ onSafe }: V2ShellPreviewScreenProps) {
  const { applyDump } = useAppServices();
  return (
    <ShellApp
      onThrow={(text) => applyDump(text, 'text')}
      onSafe={onSafe}
    />
  );
}
