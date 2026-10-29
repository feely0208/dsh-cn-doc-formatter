/** dsh-cn-doc-formatter · 宿主出口（面板后端） */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runPanel } from './run.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = '/dsh-cn-doc-formatter';
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();

const 回 = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
const 读体 = async (req) => {
  const chunks = [];
  for await (const x of req) chunks.push(x);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
};

export function registerApi(ctx) {
  const handler = async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (u.pathname === `${ROUTE}/api/info`) return 回(res, 200, { ok: true, version: VERSION });
      if (u.pathname === `${ROUTE}/api/run` && req.method === 'POST') {
        const body = await 读体(req);
        return 回(res, 200, await runPanel(body));
      }
      return 回(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      return 回(res, 500, { ok: false, text: e?.message || String(e) });
    }
  };
  ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler });
}
