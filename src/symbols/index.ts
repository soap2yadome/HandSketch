import { electrical } from './electrical';
import { network } from './network';
import { security } from './security';
import type { Domain, SymbolDef } from './types';

export * from './types';

export const SYMBOLS: SymbolDef[] = [...network, ...electrical, ...security];
const byId = new Map(SYMBOLS.map((s) => [s.id, s]));

export const DOMAINS: { id: Domain; label: string }[] = [
  { id: 'network', label: 'Network' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'security', label: 'Security / Access' },
];

export function getSymbol(id: string): SymbolDef | undefined {
  return byId.get(id);
}

export function searchSymbols(query: string, domain?: Domain): SymbolDef[] {
  const q = query.trim().toLowerCase();
  return SYMBOLS.filter((s) => (!domain || s.domain === domain) && (!q || `${s.id} ${s.label} ${s.keywords ?? ''}`.toLowerCase().includes(q)));
}
