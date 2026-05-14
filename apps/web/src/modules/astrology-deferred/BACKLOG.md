# Astrology Module — Deferred to Backlog

**Deferred:** 2026-05-14  
**Decision:** audits/DECISIONS_2026-05-14.md — Decision 2  
**Status:** DEFERRED (code preserved, not imported in main app)

## Notes

- Code preserved for future activation. 2,195 LOC fully built.
- DO NOT import from this directory in the main app.
- Module is NOT accessible to users. URL gate removed. Orchestrator disabled.

## Reactivation checklist

1. Rename directory back to `modules/astrology/`
2. Restore lazy import in `ModuleScreen.tsx` and add astrology block back
3. Set `ASTROLOGY_ENABLED = true` in `store.ts` (or set env var `VITE_ASTROLOGY_ENABLED=true`)
4. Build `/horoscope` POST endpoint in `ai-proxy` (chart hash + date → Claude, dry tone, 24h cache)
5. Add per-feature consent toggle or hook into main consent model
6. Wire `moon_phase_change` event emission so `cycle` module can consume it
7. Implement Mercury retrograde detection algorithm in `@ollie/logic/astrology`
8. Update `audits/AUDIT_astrology.md` status: DEFERRED → ACTIVE
