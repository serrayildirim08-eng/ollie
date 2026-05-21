import React, { lazy, Suspense, useState } from 'react';
import { REGISTRY } from '@ollie/events';
import * as appEventsForToast from '@ollie/events';
import { cycle } from '@ollie/logic';
import { getString } from './i18n';
import { useStoreSlice, store } from './store';
import { FrostedCard } from './components/FrostedCard';
import { ModuleHelp } from './components/ModuleHelp';
import { SourcesLink } from './components/SourcesLink';
import { ToastHost } from './components/ToastHost';
import { MicButton } from './components/MicButton';
import { ToastProvider, useToast } from './components/ToastContext';
import { Burhan3D } from './components/Burhan3D';
import { BrainDumpInput } from './components/BrainDumpInput';
import { ChipFlyHost, chipFly } from './components/ChipFly';
import { OnboardingScreen } from './pages/OnboardingScreen';
import { AuthFlow } from './components/AuthFlow';
import { ConsentScreen } from './components/ConsentScreen';
import { ConsentStep } from './screens/onboarding/ConsentStep';
import {
  configureConsent,
  getConsentSync,
  hasNecessaryConsent,
} from '@ollie/consent';
import { useApplyBrainDump } from './hooks/useApplyBrainDump';
import { trackSession, makeRetentionBridge } from './lib/retention';
import { emit as emitEvent } from '@ollie/events';
import { bootAccount } from './lib/account-boot';
import { sessionTracker } from './lib/session-tracker';
import { readUserHash } from './lib/user-hash';
import { getDeviceId, getAppVersion } from './lib/device';
import { createConsentSync } from './lib/consent-sync';
import { Day30Prompt } from './components/Day30Prompt';

import { AppRouter } from './router';
import { ClerkAuthBridge } from './components/ClerkAuthBridge';

export function App() {
  return (
    <>
      {/*
        ClerkAuthBridge pumps the active Clerk session JWT into a sync
        module-scope ref so non-React modules (account-boot.getAuthJwt,
        aiRoute, /label, /enrich-dump, /generate-invite) can read it
        without going async. Renders nothing.
      */}
      <ClerkAuthBridge />
      <AppRouter />
    </>
  );
}
