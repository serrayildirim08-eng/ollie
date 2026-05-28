-- ollie · module-agnostic AI routing cache (T1)
--
-- Single table for all modules: grocery, work, body, dump, money, admin,
-- pets, habits, health, finance, sleep, cycle, goals.
--
-- Uses pgvector for HNSW cosine-similarity lookups (Voyage multilingual-2
-- embeddings, 1024-dim). The `module` column acts as a soft partition:
-- every cache lookup MUST filter on module so grocery hits never pollute
-- work queries.
--
-- RLS: service_role only — the CF worker writes + reads via the Supabase
-- service key. End-users never touch this table directly; the routing
-- endpoint is the only public surface.
--
-- Rollback:
--   drop table if exists public.routing_cache;
--   drop extension if exists vector;

-- Enable pgvector if not already present (idempotent).
create extension if not exists vector;

-- ─── table ────────────────────────────────────────────────────────────────────

create table public.routing_cache (
  id             uuid primary key default gen_random_uuid(),

  -- Which app module produced this cache entry. Always filter on this
  -- when doing similarity search — module boundaries must not bleed.
  module         text not null
                   check (module in (
                     'grocery','work','body','dump','money','admin',
                     'pets','habits','health','finance','sleep','cycle','goals'
                   )),

  -- Voyage multilingual-2 embedding of the original user text (1024-dim).
  embedding      vector(1024),

  -- Structured classification result. Schema is module-specific:
  --   grocery → { intent, items[], category, qty, shelfLifeDays, fromRecipe }
  --   other modules → open jsonb per module spec
  classification jsonb not null,

  -- Detected BCP-47 language tag (e.g. 'en', 'es', 'tr').
  language       text,

  -- How many times this entry has been returned as a cache hit.
  hit_count      int not null default 0,

  created_at     timestamptz not null default now(),

  -- Updated by the worker each time this entry is served as a hit.
  last_hit_at    timestamptz
);

-- ─── index ────────────────────────────────────────────────────────────────────

-- HNSW for fast approximate-NN cosine search, filtered by module.
-- m=16 / ef_construction=64 are pgvector defaults; tunable post-launch.
create index routing_cache_embedding_hnsw
  on public.routing_cache
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- B-tree on module so the `module = $1` filter in the worker is index-backed.
create index routing_cache_module_idx
  on public.routing_cache (module);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

alter table public.routing_cache enable row level security;

-- Only the service_role (CF worker) may read or write. No anon/user access.
create policy "service_role full access"
  on public.routing_cache
  to service_role
  using (true)
  with check (true);
