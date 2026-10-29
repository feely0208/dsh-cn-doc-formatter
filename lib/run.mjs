/**
 * 面板后端：选 .md/.txt + 输出目录 → 调随包 python 脚本出 docx / pdf / txt。
 *
 * 复用 skill/scripts 里已有的排版脚本，不重写排版逻辑：
 *   md_adapter.py     Markdown → 公文体正文
 *   docx_formatter.py / pdf_formatter.py / txt_formatter.py  → 三种产物
 *
 * Python 或依赖缺失时返回可读错误，不抛异常（面板不能白屏）。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.DSH_PYTHON || 'python3';
const MAX_BODY = 100000;

function script(name) {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', 'skill', 'scripts', name);
}

function runPy(args, timeout = 120000) {
  return new Promise((resolveP) => {
    execFile(PYTHON, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolveP({ ok: false, text: `找不到 ${PYTHON}。本插件的排版脚本需要 Python 3 + python-docx + reportlab。` });
          return;
        }
        if (err.killed) { resolveP({ ok: false, text: '排版脚本执行超时（120 秒）' }); return; }
        const tail = String(stderr || '').trim().split('\n').slice(-6).join('\n');
        resolveP({ ok: false, text: `排版脚本失败：${tail || err.message}` });
        return;
      }
      resolveP({ ok: true, text: String(stdout || '').trim() });
    });
  });
}

function firstHeading(md) {
  for (const line of String(md).split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].replace(/[*_`]/g, '').trim();
  }
  return '';
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\n\r\t]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function runPanel(opts = {}) {
  const input = String(opts.input || '').trim();
  let out = String(opts.out || '').trim();
  const titleOpt = String(opts.title || '').trim();
  const sender = String(opts.sender || '').trim();
  const date = String(opts.date || '').trim();
  const formats = Array.isArray(opts.formats) && opts.formats.length
    ? opts.formats.filter((f) => ['docx', 'pdf', 'txt'].includes(f))
    : ['docx', 'pdf', 'txt'];

  if (!input) return { ok: false, text: '请填写要排版的 .md / .txt 文件路径' };
  if (!out) out = join(dirname(String(input)), '公文排版输出');
  if (!existsSync(input)) return { ok: false, text: '文件不存在：' + resolve(input) };
  const inputPath = resolve(input);
  if (!statSync(inputPath).isFile()) return { ok: false, text: '请输入单个文件（暂不支持整个目录）' };
  const ext = extname(inputPath).toLowerCase();
  if (!['.md', '.markdown', '.txt'].includes(ext)) return { ok: false, text: '只支持 .md / .txt 输入' };
  if (!formats.length) return { ok: false, text: '至少要选一种输出格式（docx / pdf / txt）' };

  let raw;
  try { raw = readFileSync(inputPath, 'utf8'); }
  catch (e) { return { ok: false, text: `读取失败：${e?.message || e}` }; }

  const title = titleOpt || (ext === '.txt' ? basename(inputPath, ext) : firstHeading(raw)) || basename(inputPath, ext);
  const base = safeName(title) || safeName(basename(inputPath, ext)) || '公文';

  let body = raw;
  let tmpBody = '';
  try {
    if (ext !== '.txt') {
      tmpBody = join(tmpdir(), `dsh-cndoc-${process.pid}-${Date.now()}.txt`);
      const conv = await runPy([script('md_adapter.py'), '--input', inputPath, '--output', tmpBody]);
      if (!conv.ok) return { ok: false, text: 'Markdown 转公文体失败：' + conv.text };
      body = readFileSync(tmpBody, 'utf8');
    }
    if (!body.trim()) return { ok: false, text: '正文为空：Markdown 里除了标题没有可排版的内容' };
    if (body.length > MAX_BODY) return { ok: false, text: `正文过长（${body.length} 字符，上限 ${MAX_BODY}）` };

    const outDir = resolve(out);
    try { mkdirSync(outDir, { recursive: true }); }
    catch (e) { return { ok: false, text: `无法创建输出目录：${outDir}（${e?.message || e}）` }; }

    const written = [];
    for (const fmt of formats) {
      const filename = `${base}.${fmt}`;
      const args = [
        script(`${fmt}_formatter.py`),
        '--output', outDir,
        '--filename', filename,
        '--title', title,
        '--body', body,
      ];
      if (sender) args.push('--sender', sender);
      if (date) args.push('--date', date);
      const r = await runPy(args);
      if (!r.ok) return { ok: false, text: `${fmt} 生成失败：${r.text}` };
      const full = join(outDir, filename);
      if (!existsSync(full)) return { ok: false, text: `${fmt} 脚本未产出文件：${full}` };
      written.push({ name: filename, path: full, bytes: statSync(full).size });
    }

    const lines = [
      `已生成 ${written.length} 份文件 → ${outDir}`,
      `  源文件 ${inputPath}`,
      `  标题   ${title}`,
      '',
      ...written.map((w) => `  ✅ ${w.name}  ${(w.bytes / 1024).toFixed(1)} KB  ${w.path}`),
      '',
      '提示：字体由本机自备（DSH_CN_FANGSONG 或系统字体目录）；PDF 缺仿宋时会退回宋体并在 stderr 给出指引。',
      '如需逐项核对页边距/字号/行距，可再跑 skill/scripts/verify_output.py --dir <输出目录>。',
    ];
    return { ok: true, text: lines.join('\n'), outputs: { dir: outDir, files: written }, title };
  } finally {
    if (tmpBody) { try { unlinkSync(tmpBody); } catch {} }
  }
}
