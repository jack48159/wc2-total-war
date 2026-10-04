import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The rule engine loads the same game data through relative fetch() in browsers.
// Resolve those reads against the deployed asset tree on the authoritative server.
const root = path.resolve(import.meta.dirname, '..');
const privateEngine = path.join(import.meta.dirname, 'engine');
const deployed = existsSync(path.join(privateEngine, 'src/game/game.js'));
const assetRoot = deployed ? path.join(privateEngine, 'assets') : path.join(root, 'project/app/src/main/assets');
const dataRoot = deployed ? path.join(privateEngine, 'data') : path.join(assetRoot, 'remake/data');
const fallbackRoot = deployed ? privateEngine : path.join(root, 'public');
export const stageDirectory = path.join(dataRoot, 'stages');
export const scenarioDirectory = path.join(fallbackRoot, 'scenarios');
export const gameModule = relative => pathToFileURL(path.join(deployed ? privateEngine : fallbackRoot, 'src/game', relative)).href;
const nativeFetch = globalThis.fetch;
globalThis.window ||= {};
globalThis.location ||= { search: '', href: '' };
globalThis.fetch = async (input, init) => {
  if (typeof input !== 'string' || /^(?:https?:)?\/\//.test(input)) return nativeFetch(input, init);
  const rel = input.replace(/^\/+/, '');
  if (rel.includes('..') || !/^(data|assets|scenarios)\//.test(rel)) throw new Error(`Invalid game asset: ${input}`);
  const candidate = rel.startsWith('data/') ? path.join(dataRoot, rel.slice(5))
    : rel.startsWith('assets/') ? path.join(assetRoot, rel.slice(7))
    : path.join(fallbackRoot, rel);
  let body;
  try { body = await fs.readFile(candidate); }
  catch (error) {
    if (rel.startsWith('data/')) body = await fs.readFile(path.join(fallbackRoot, rel));
    else throw error;
  }
  return new Response(body, { status: 200 });
};
