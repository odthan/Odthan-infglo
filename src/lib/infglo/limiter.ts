import { RateLimiter } from './security';
/** Limiteur partagé par toutes les fonctions IA d'une instance serveur : 6 générations en rafale, puis 1 toutes les 20 s (par clé = utilisateur). */
export const aiLimiter = new RateLimiter(6, 1 / 20);
