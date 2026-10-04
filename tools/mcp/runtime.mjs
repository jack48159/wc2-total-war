import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '../..');
export const publicRoot = path.join(root, 'public');
export const assetRoot = path.join(root, 'project/app/src/main/assets');
export const dataRoot = path.join(assetRoot, 'remake/data');
const nativeFetch = globalThis.fetch;

globalThis.window ||= globalThis;
globalThis.location ||= { search: '', href: '' };
globalThis.GameLogger ||= { isDebug: () => false };
// stdio MCP reserves stdout for JSON-RPC. The game engine has diagnostic logs,
// so route them to stderr without muting useful diagnostics.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
globalThis.fetch = async (input, init) => {
  if (typeof input !== 'string' || /^(?:https?:)?\/\//.test(input)) return nativeFetch(input, init);
  const rel = input.replace(/^\/+/, '').split('?')[0];
  if (rel.includes('..') || !/^(data|assets|scenarios)\//.test(rel)) throw new Error(`Invalid game asset: ${input}`);
  const candidates = rel.startsWith('data/')
    ? [path.join(dataRoot, rel.slice(5)), path.join(publicRoot, rel)]
    : rel.startsWith('assets/') ? [path.join(assetRoot, rel.slice(7))] : [path.join(publicRoot, rel)];
  let body = null;
  for (const candidate of candidates) if (existsSync(candidate)) { body = await fs.readFile(candidate); break; }
  if (!body) throw new Error(`Game asset not found: ${rel}`);
  return new Response(body, { status: 200 });
};
