'use server';
import { redirect } from 'next/navigation';
import { getAccess, logActivity } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { GenerativeClient, aiLimiter, generateForMessage, type AiKind } from '@/lib/infglo/server';

const STATUSES = ['new', 'read', 'replied', 'archived'];

async function run(kind: AiKind, fd: FormData): Promise<never> {
  const a = await getAccess();
  if (!a.user) redirect('/login');
  if (!a.permissions.includes('contact.manage')) throw new Error('forbidden');
  const id = String(fd.get('id') ?? ''); const st = String(fd.get('status') ?? '');
  const base = `/admin/contact${STATUSES.includes(st) ? `?status=${st}&` : '?'}`;
  const back = (k: 'm' | 'e', msg: string) => redirect(`${base}${k}=${encodeURIComponent(msg)}#msg-${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back('e', 'Message invalide.');

  // Lecture via la session de l'utilisateur : RLS vérifie qu'il a bien le droit de voir ce message.
  const { data: msg } = await (await createClient()).from('contact_messages').select('id,subject,message').eq('id', id).maybeSingle();
  if (!msg) return back('e', 'Message introuvable.');

  const r = await generateForMessage(createAdminClient(), new GenerativeClient({ limiter: aiLimiter }), kind, msg, a.user.id);
  if (!r.ok) {
    return back('e', r.reason === 'disabled' ? 'IA non configurée : ajoutez ANTHROPIC_API_KEY dans Vercel (Environment Variables).'
      : r.reason === 'storage' ? 'Génération réussie mais enregistrement impossible : exécutez la migration 009.'
      : 'IA momentanément indisponible ou limite atteinte. Réessayez dans quelques secondes.');
  }
  if (!r.cached) await logActivity(kind === 'summary' ? 'contact.ai_summary' : 'contact.ai_draft', 'contact_message', id);   // journal existant, sans contenu
  return back('m', r.cached ? 'Déjà généré.' : kind === 'summary' ? 'Résumé IA généré.' : 'Brouillon de réponse généré.');
}

export async function aiSummarize(fd: FormData) { return run('summary', fd); }
export async function aiDraft(fd: FormData) { return run('draft', fd); }
