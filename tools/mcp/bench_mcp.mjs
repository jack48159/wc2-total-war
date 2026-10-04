#!/usr/bin/env node
// 统计一回合典型调用的次数与返回字节数(不调模型)。用法: node tools/mcp/bench_mcp.mjs [stage]
import { spawn } from 'node:child_process';
const stage = process.argv[2] || 'conquest_1';
const p = spawn(process.execPath, ['tools/mcp/wc2_mcp_server.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', id = 0; const waiters = new Map();
p.stdout.setEncoding('utf8'); p.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l) continue; const m = JSON.parse(l); waiters.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise(r => { const n = ++id; waiters.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
let calls = 0, bytes = 0;
const call = async (name, args = {}) => { const m = await rpc('tools/call', { name, arguments: args }); const t = m.result?.content?.[0]?.text ?? JSON.stringify(m.error); calls++; bytes += t.length; return JSON.parse(t); };
await rpc('initialize', {});
await call('wc2_new_game', { stage, seed: 1, slot: 'bench', reason: '基准测试开局，统计调用次数与返回体积。' });
const b = await call('wc2_get_turn_brief');
const cmds = [{ type: 'attack', from: 1, to: 2, armyId: 1, when: { minKill: 0.99 } }];
const r = await call('wc2_do_batch', { commands: cmds, reason: '条件批量测试：要求击杀概率极高才攻击，应被跳过。' });
console.log(JSON.stringify({ stage, briefKeys: Object.keys(b), batchSkipped: r.skipped, batchOk: r.ok, calls, bytes }));
p.kill();
