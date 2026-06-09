/**
 * apps/native · api/index.ts — barrel
 */

export { getSupabaseClient, supabase } from './supabase';

export {
  brainDump,
  routeDump,
  routeTranscribe,
  mintPartnerCode,
  pairPartner,
  getPartnerSnapshot,
  putPartnerSnapshot,
  unpairPartner,
  enrichDump,
  ingestEvent,
  label,
  generateInvite,
  validateInvite,
  claimInvite,
  pushSend,
  sentryTunnel,
} from './workers';

export type {
  ApiError,
  ApiResult,
  BrainDumpRequest,
  BrainDumpResponse,
  RouteDumpRequest,
  RouteDumpImage,
  RouteDumpImageMime,
  EnrichDumpRequest,
  EnrichDumpResponse,
  IngestEventRequest,
  IngestEventResponse,
  IngestTable,
  LabelRequest,
  LabelResponse,
  GenerateInviteRequest,
  GenerateInviteResponse,
  ValidateInviteRequest,
  ValidateInviteResponse,
  ClaimInviteRequest,
  ClaimInviteResponse,
  PushRegisterRequest,
  PushRegisterResponse,
  SentryEnvelope,
} from './types';

export type { PartnerSnapshotWire, PartnerSnapshotResult } from './workers';
