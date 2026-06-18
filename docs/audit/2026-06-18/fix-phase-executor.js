/* eslint-disable -- workflow script: runs in the Workflow runtime where
   agent/parallel/phase/log/args are injected globals, not app code. */
/**
 * Phase executor for the audit remediation roadmap.
 *
 * Runs ONE phase of docs/audit/2026-06-18/fix-plan.json at a time.
 * For that phase it fans out the executability="auto" findings — each fix
 * happens in its OWN git worktree (isolation) so parallel fixes can't collide,
 * each runs its own verify, and returns a structured report. The "assisted"
 * and "manual-or-prod" findings are LISTED (not auto-fixed) for human/Serra.
 *
 * Run it:
 *   Workflow({ scriptPath: ".../fix-phase-executor.js", args: { phase: "P1" } })
 * Then review the per-finding worktree branches and integrate the good ones.
 *
 * NOTE: this is the executor template produced 2026-06-18. Adjust the verify
 * commands / integration step when P1 actually runs (after the P0 decisions).
 */
export const meta = {
  name: 'audit-fix-phase-executor',
  description: 'Execute one phase of the audit fix-plan: fan out auto-fixable findings in isolated worktrees, fix + verify each, report for review',
  phases: [
    { title: 'Load phase' },
    { title: 'Fix + verify' },
    { title: 'Report' },
  ],
}

const PLAN = '/Users/serrayildirim/ollie/docs/audit/2026-06-18/fix-plan.json'
const PHASE = (args && args.phase) || 'P1'

phase('Load phase')
const LOAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['auto', 'deferred'],
  properties: {
    auto: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'approach', 'verify'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          approach: { type: 'string' }, verify: { type: 'string' },
        },
      },
    },
    deferred: { type: 'array', items: { type: 'string' }, description: 'id + why (assisted / manual-or-prod) — listed, not auto-fixed' },
  },
}

const loaded = await agent(
  `Read ${PLAN} (JSON array of fix-plan entries, each with id, title, approach, verify, executability, phase). ` +
  `Return: "auto" = entries where phase=="${PHASE}" AND executability=="auto" (id,title,approach,verify); ` +
  `"deferred" = entries where phase=="${PHASE}" AND executability!="auto", each as "id — title (executability)".`,
  { label: `load:${PHASE}`, phase: 'Load phase', schema: LOAD_SCHEMA },
)

const todo = (loaded && loaded.auto) || []
log(`${PHASE}: ${todo.length} auto-fixable findings; ${(loaded && loaded.deferred || []).length} deferred to human/Serra.`)

phase('Fix + verify')
const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'summary', 'filesChanged', 'verifyResult', 'branch'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    verifyResult: { type: 'string', description: 'the actual result of running the verify step' },
    branch: { type: 'string', description: 'the worktree branch holding the change (or empty if blocked)' },
  },
}

const results = await parallel(
  todo.map((f) => () =>
    agent(
      `You are fixing ONE audit finding in the Ollie monorepo, in your OWN isolated git worktree. ` +
      `FINDING #${f.id}: ${f.title}\nAPPROACH: ${f.approach}\nVERIFY: ${f.verify}\n\n` +
      `Implement the fix precisely per the approach (read the real code first). Then run the verify step and report its actual result. ` +
      `Do NOT broaden scope beyond this finding. Commit your change in the worktree with a message "fix(audit): #${f.id} <title>". ` +
      `If you cannot fix it safely or verify fails for a reason you cannot resolve, set status=blocked and explain. Return the schema.`,
      { label: `fix:#${f.id}`, phase: 'Fix + verify', schema: FIX_SCHEMA, isolation: 'worktree' },
    ),
  ),
)

phase('Report')
const fixed = results.filter(Boolean).filter((r) => r.status === 'fixed')
const blocked = results.filter(Boolean).filter((r) => r.status !== 'fixed')

return {
  phase: PHASE,
  attempted: todo.length,
  fixed: fixed.length,
  blocked: blocked.length,
  deferredToHuman: (loaded && loaded.deferred) || [],
  results: results.filter(Boolean),
}
