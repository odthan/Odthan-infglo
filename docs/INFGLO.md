# InfGlo — intégré à ODTHAN
Moteur d'intelligence d'ODTHAN (Infinite Vision Global Ambition). Intégré nativement : 4 fichiers existants ont reçu une modification minimale (voir plus bas), tout le reste est ajouté.

## Mise en service (≈ 10 min)
1. **Supabase** : exécuter `supabase/migrations/008_infglo.sql` puis `009_infglo_message_ai.sql` et `010_infglo_request_ai.sql` (ou, depuis le téléphone, `supabase/sql-mobile/008-01-sur-02.sql`, `008-02-sur-02.sql`, `009-01-sur-01.sql`, puis `010-01-sur-01.sql`). RLS activé sans politique : aucune lecture/écriture depuis le navigateur.
2. **Vercel → Environment Variables** (voir `.env.infglo.example`) : `CRON_SECRET` et `INFGLO_SALT` (chaînes aléatoires longues). Facultatif : `ANTHROPIC_API_KEY`. Laissez `INFGLO_AUTOMATION=dry-run` au début. `SUPABASE_SERVICE_ROLE_KEY` est déjà requise par le projet.
3. Déployer, puis ouvrir **Admin → InfGlo (IA) → Lancer l'analyse**. Le cycle tourne ensuite chaque jour à 06:00 UTC (`vercel.json`) ; en plan Pro, passez à `0 * * * *`.
4. Quand les alertes vous semblent justes, passez `INFGLO_AUTOMATION=live` : les alertes deviennent de vraies notifications ODTHAN (table `notifications` → Push existant) envoyées aux rôles concernés.

Accès : permission `users.manage` (SUPER_ADMIN, ADMIN), comme « Utilisateurs & rôles ».

## Assistant IA dans `/admin/contact`
Chaque message affiche des pastilles de tri instantanées et gratuites (Urgent, thème, langue, ton). Deux boutons, à la demande d'un membre de l'équipe (permission `contact.manage`) :
- **Résumer avec l'IA** : 2 phrases + action recommandée ;
- **Proposer un brouillon de réponse** : dans la langue du client, sans promettre prix ni délai, à relire ; bouton « Ouvrir dans ma messagerie ».
Chaque génération est mise en cache (table `infglo_message_ai`, supprimée avec le message), limitée par utilisateur, journalisée dans `admin_activity_logs` (sans contenu). Sans `ANTHROPIC_API_KEY`, seules les pastilles s'affichent.
**Confidentialité** : le texte du message est envoyé à l'API Anthropic (e-mails, téléphones et numéros de carte masqués avant l'envoi). Mentionnez ce traitement (messages de contact et descriptions de demandes) dans votre page « Confidentialité » avant d'activer la clé.

## Assistant IA dans `/admin/requests/[id]`
Sur la fiche d'une demande : pastilles de tri (En attente > 48 h, Urgent, thème, langue, ton, budget/délai non précisés, description courte) et encart « InfGlo · assistant IA » :
- **Résumer la demande avec l'IA** (permission `requests.view`) : le besoin, les contraintes, les informations manquantes à demander ;
- **Proposer un message au client** (permission `messages.reply`) : accusé de réception + questions, dans la langue du client, sans promesse de prix ni de délai ; bouton **Copier** pour le coller dans la conversation.
**Le nom, l'e-mail et le téléphone du client ne sont jamais transmis à l'IA** (seulement service, projet, lieu, budget, date souhaitée, description — avec masquage automatique des coordonnées qui figureraient dans le texte). Même cache, même limiteur et même journalisation que pour les messages de contact.

## Fichiers existants modifiés (6)
| Fichier | Modification |
|---|---|
| `src/app/admin/layout.tsx` | +1 ligne : entrée de menu « InfGlo (IA) » |
| `src/components/Icon.tsx` | +1 icône `infglo` |
| `src/app/(site)/auth-actions.ts` | login refusé → échec anonymisé (hash salé) transmis à InfGlo ; protégé par try/catch, ne bloque jamais la connexion |
| `vercel.json` | +1 tâche planifiée `crons` |
| `src/app/admin/contact/page.tsx` | pastilles de tri + encart « InfGlo · assistant IA » (le reste de la page est inchangé) |
| `src/app/admin/requests/[id]/page.tsx` | pastilles + encart « InfGlo · assistant IA » entre la fiche et le statut (le reste est inchangé) |

## Architecture (12 modules)
| Module | Fichiers (`src/lib/infglo/`) | Rôle |
|---|---|---|
| Core | `core.ts`, `types.ts` | Bus d'évènements, registre, santé, erreurs isolées |
| AI Engine | `anomaly.ts`, `nlp.ts`, `recommend.ts`, `generative.ts` | Anomalies, NLP FR/Créole/EN, recommandations, IA Claude (résumés/brouillons) |
| Analytics | `stats.ts`, `modules.ts`, `dashboard.ts` | Statistiques robustes, tendances |
| Predict | `predict.ts` | Prévision 7 jours + intervalle 95 % |
| Automation | `automation.ts`, `actions.ts` | dry-run par défaut, approbation humaine des actions sensibles |
| Security | `security.ts` | Audit chaîné SHA-256, force brute, limiteur de débit, masquage PII |
| Decision Engine | `decision.ts`, `odthan-rules.ts` | Règles JSON, score de risque |
| Learning | `learning.ts` | Retours 👍/👎 → règles inutiles mises en sourdine |
| API | `src/app/api/infglo/*` | `snapshot` (admin) · `cron` (secret) |
| Cloud Services | `supabase-repo.ts`, `008_infglo.sql` | Persistance, tâche quotidienne |
| Monitoring | `optimizer.ts` | Compteurs, santé des modules (affichée dans l'interface) |
| Performance Optimizer | `optimizer.ts` | Cache TTL/LRU, latences p50/p95 |

Règles livrées (données réelles ODTHAN) : demandes `new/analyzing` > 48 h, file de demandes en hausse, messages de contact `new/read` > 24 h, pic d'échecs de connexion, services en brouillon.

## Sécurité
RLS sans politique sur les 7 tables `infglo_*` · accès serveur après `checkPerm` · cron protégé par secret (temps constant) · audit infalsifiable · identités hachées · PII masquées avant envoi à l'IA · texte client traité comme donnée · actions sensibles = approbation humaine · mémoire bornée.

## Vérifié / non vérifié
- ✔ 46 tests (dont cycle complet sur dépôt en mémoire) ; TypeScript strict sur toute la logique ; pages/routes vérifiées avec les signatures réelles de `auth.ts`.
- ✘ Non exécutés ici : la migration SQL (pas de PostgreSQL), les requêtes Supabase réelles, `next build`, l'appel réel à l'API Claude. Lancez `npm run typecheck && npm test` puis testez sur une préproduction.
- Pas de Deep Learning/vision : inutiles pour ces données. Le recommandeur de services est prêt mais pas encore affiché dans une page.
- Vercel Hobby : cron limité à 1×/jour.
