-- ODTHAN INFGLO — fichier unique 010 (résumés IA des demandes de service). Exécuter après 009.
-- ODTHAN — 010 : InfGlo, résumés et brouillons IA des demandes de service (cache : une génération par demande).
-- Supprimer une demande supprime aussi son résumé (on delete cascade).
create table if not exists public.infglo_request_ai (
  request_id uuid primary key references public.service_requests(id) on delete cascade,
  summary text check (summary is null or char_length(summary) <= 2000),
  draft text check (draft is null or char_length(draft) <= 2000),
  model text,
  created_at timestamptz not null default now()
);
alter table public.infglo_request_ai enable row level security;   -- aucune politique : accès serveur (service_role) uniquement
revoke all on public.infglo_request_ai from anon, authenticated;
