-- ODTHAN — 008 : InfGlo (moteur d'intelligence). Exécuter après 001–007.
-- SÉCURITÉ : RLS activé SANS aucune politique pour anon/authenticated = accès refusé à tous ;
-- seuls les routes/actions serveur (clé service_role, après vérification de permission) lisent et écrivent ici.

create table if not exists public.infglo_metrics (
  id bigserial primary key,
  name text not null check (name ~ '^[a-zA-Z0-9_.:-]{1,80}$'),
  value double precision not null,
  at timestamptz not null default now()
);
create index if not exists infglo_metrics_name_at on public.infglo_metrics (name, at desc);

create table if not exists public.infglo_insights (
  id uuid primary key default gen_random_uuid(),
  core_id text,
  kind text not null check (kind in ('anomaly','prediction','recommendation','alert')),
  severity text not null check (severity in ('info','low','medium','high','critical')),
  title text not null,
  detail text not null default '',
  source text not null default 'infglo',
  data jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','escalated','dismissed','resolved')),
  created_at timestamptz not null default now()
);
create index if not exists infglo_insights_created on public.infglo_insights (created_at desc);
create index if not exists infglo_insights_status on public.infglo_insights (status, severity);

create table if not exists public.infglo_feedback (
  id bigserial primary key,
  insight_id uuid references public.infglo_insights(id) on delete cascade,
  rule_id text,
  useful boolean not null,
  user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.infglo_actions (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid references public.infglo_insights(id) on delete cascade,
  action text not null,
  status text not null default 'pending' check (status in ('pending','done','failed','dry-run','rejected')),
  result text,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);

-- Journal d'audit chaîné (SHA-256) : hash unique, seq croissante.
create table if not exists public.infglo_audit (
  seq bigint primary key,
  at bigint not null,
  actor text not null,
  action text not null,
  target text,
  data jsonb,
  prev text not null,
  hash text not null unique
);

-- Échecs de connexion anonymisés (hachage salé, jamais d'e-mail ni d'IP en clair).
create table if not exists public.infglo_security_events (
  id bigserial primary key,
  kind text not null check (kind in ('login_failed')),
  key_hash text not null,
  at timestamptz not null default now()
);
create index if not exists infglo_sec_kind_at on public.infglo_security_events (kind, at desc);

create table if not exists public.infglo_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  risk integer not null default 0,
  summary jsonb not null default '{}'::jsonb
);

alter table public.infglo_metrics enable row level security;
alter table public.infglo_insights enable row level security;
alter table public.infglo_feedback enable row level security;
alter table public.infglo_actions enable row level security;
alter table public.infglo_audit enable row level security;
alter table public.infglo_security_events enable row level security;
alter table public.infglo_runs enable row level security;

revoke all on public.infglo_metrics, public.infglo_insights, public.infglo_feedback, public.infglo_actions,
  public.infglo_audit, public.infglo_security_events, public.infglo_runs from anon, authenticated;
revoke all on sequence public.infglo_metrics_id_seq, public.infglo_feedback_id_seq, public.infglo_security_events_id_seq, public.infglo_runs_id_seq from anon, authenticated;
