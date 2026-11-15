'use server';
import { redirect } from 'next/navigation';
import { getAccess, logActivity } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { GenerativeClient, aiLimiter, generateForRequest, type AiKind } from '@/lib/infglo/server';

async function run(kind: AiKind, fd: FormData): Promise<never> {
  const a = await getAccess();
  if (!a.user) redirect('/login');
  // Résumé : toute personne autorisée à voir les demandes. Brouillon de réponse : seulement celles qui peuvent répondre aux clients.
  if (!a.permissions.includes(kind === 'summary' ? 'requests.view' : 'messages.reply')) throw new Error('forbidden');
  const id = String(fd.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/admin/requests');
  const back = (k: 'm' | 'e', msg: string) => redirect(`/admin/requests/${id}?${k}=${encodeURIComponent(msg)}#infglo`);

  // Lecture via la session de l'utilisateur : RLS vérifie son droit de voir cette demande. Aucune coordonnée du client n'est lue.
  const { data: r } = await (await createClient()).from('service_requests')
    .select('id,service_name,project_name,description,country,city,budget_amount,budget_currency,desired_date').eq('id', id).maybeSingle();
  if (!r) return back('e', 'Demande introuvable.');

  const res = await generateForRequest(createAdminClient(), new GenerativeClient({ limiter: aiLimiter }), kind, r, a.user.id);
  if (!res.ok) {
    return back('e', res.reason === 'disabled' ? 'IA non configurée : ajoutez ANTHROPIC_API_KEY dans Vercel (Environment Variables).'
      : res.reason === 'storage' ? 'Génération réussie mais enregistrement impossible : exécutez la migration 010.'
      : 'IA momentanément indisponible ou limite atteinte. Réessayez dans quelques secondes.');
  }
  if (!res.cached) await logActivity(kind === 'summary' ? 'requests.ai_summary' : 'requests.ai_draft', 'service_request', id);   // journal existant, sans contenu
  return back('m', res.cached ? 'Déjà généré.' : kind === 'summary' ? 'Résumé IA généré.' : 'Brouillon de réponse généré.');
}

export async function aiRequestSummary(fd: FormData) { return run('summary', fd); }
export async function aiRequestDraft(fd: FormData) { return run('draft', fd); }
