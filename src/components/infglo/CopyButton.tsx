'use client';
import { useState } from 'react';

/** Copie un texte dans le presse-papiers (pratique sur mobile pour coller un brouillon dans la messagerie). */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className={className} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); } catch { /* presse-papiers refusé */ } }}>{ok ? 'Copié ✓' : 'Copier'}</button>;
}
