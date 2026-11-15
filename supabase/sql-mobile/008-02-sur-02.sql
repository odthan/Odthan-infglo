-- ODTHAN INFGLO — partie 2/2 du fichier 008_infglo.sql (sécurité RLS). Exécuter après la partie 1.

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
