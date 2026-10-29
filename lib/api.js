/** dsh-cn-doc-formatter · 宿主出口（面板后端） */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
      if (u.pathname === `${ROUTE}/api/upload` && req.method === 'POST') {
        const b = await 读体(req);
        const files = Array.isArray(b.files) ? b.files : [];
        if (!files.length) return 回(res, 400, { ok: false, error: '没有收到文件' });
        const dir = mkdtempSync(join(tmpdir(), 'dwh-legal-'));
        let total = 0; const paths = [];
        for (const f of files) {
          const name = String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
          const buf = Buffer.from(String(f.data || ''), 'base64');
          total += buf.length;
          if (total > 60 * 1024 * 1024) return 回(res, 413, { ok: false, error: '文件累计超过 60MB' });
          const fp = join(dir, name); writeFileSync(fp, buf); paths.push(fp);
        }
        return 回(res, 200, { ok: true, dir, path: paths.length === 1 ? paths[0] : dir, count: paths.length });
      }
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
