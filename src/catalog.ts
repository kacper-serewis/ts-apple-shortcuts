import { readFileSync } from "node:fs";
export interface CatalogAction {
  id: string; name: string; platforms: string[];
  category: string; functionName: string; resultType?: string;
  parameters: { key: string; type: string; name?: string }[];
}
export interface Catalog { source: string; version: string; actions: CatalogAction[] }
export function readCatalog(): Catalog {
  return JSON.parse(readFileSync(new URL("../../data/actions.json", import.meta.url), "utf8"));
}
export function searchActions(query: string): CatalogAction[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return readCatalog().actions.filter(action => words.every(word => `${action.id} ${action.name} ${action.category}.${action.functionName}`.toLowerCase().includes(word)));
}
