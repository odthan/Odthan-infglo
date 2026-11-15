-- ODTHAN — 009 : InfGlo, résumés et brouillons IA des messages de contact (cache : une génération par message).
-- Supprimer un message de contact supprime aussi son résumé (on delete cascade).
create table if not exists public.infglo_message_ai (
  message_id uuid primary key references public.contact_messages(id) on delete cascade,
  summary text check (summary is null or char_length(summary) <= 2000),
  draft text check (draft is null or char_length(draft) <= 2000),
  model text,
  created_at timestamptz not null default now()
);
alter table public.infglo_message_ai enable row level security;   -- aucune politique : accès serveur (service_role) uniquement
revoke all on public.infglo_message_ai from anon, authenticated;
