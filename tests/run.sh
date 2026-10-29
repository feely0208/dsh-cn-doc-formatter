#!/bin/bash
# dsh-cn-doc-formatter · 面板后端验证
# 覆盖：md → docx/pdf/txt 三种产物真的生成、标题提取、坏输入优雅报错
set -uo pipefail
export PATH="/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""; echo "  $(node -p "require('./package.json').name") · 公文排版面板验证"
echo "  ────────────────────────────────────────────────"

TMP=$(mktemp -d) || { echo "无法创建临时目录"; exit 1; }
trap 'rm -rf "$TMP"' EXIT

node --input-type=module -e "
import { runPanel } from '$PWD/lib/run.mjs';
const r = await runPanel({ input: '$PWD/tests/sample.md', out: '$TMP/out', sender: '深鲸科技有限公司', date: '2026年10月29日' });
if (!r.ok) { console.error(r.text); process.exit(1); }
if (r.title !== '关于开展年度安全检查的通知') { console.error('标题提取错误：' + r.title); process.exit(1); }
if (r.outputs.files.length !== 3) { console.error('产物数量不对'); process.exit(1); }
" >"$TMP/run.log" 2>&1
[ "$?" = "0" ] && ok "md → docx/pdf/txt 三份产物生成，标题取自第一个 # 标题" || bad "排版失败：$(head -5 "$TMP/run.log")"

for f in "$TMP"/out/*.docx "$TMP"/out/*.pdf "$TMP"/out/*.txt; do
  [ -s "$f" ] && ok "生成非空 $(basename "$f")" || bad "缺少或空文件 $f"
done
head -c 4 "$TMP"/out/*.pdf | grep -q "%PDF" && ok "PDF 文件头正确" || bad "PDF 文件头不对"
python3 - "$TMP"/out/*.docx <<'PY' && ok "docx 可被 python-docx 打开且含正文" || bad "docx 打不开"
import sys, docx
d = docx.Document(sys.argv[1])
text = '\n'.join(p.text for p in d.paragraphs)
assert '年度安全检查' in text, text[:100]
PY

node --input-type=module -e "
import { runPanel } from '$PWD/lib/run.mjs';
const a = await runPanel({ input: '/nonexistent-x.md', out: '$TMP/x' });
const b = await runPanel({ input: '$PWD/tests/sample.md', out: '' });
const c = await runPanel({ input: '$PWD/lib/run.mjs', out: '$TMP/y' });
if (a.ok || b.ok || c.ok) { console.error('坏输入未报错', a.ok, b.ok, c.ok); process.exit(1); }
" >"$TMP/bad.log" 2>&1
[ "$?" = "0" ] && ok "坏输入优雅报错（路径不存在 / 缺输出目录 / 非 md 文本）" || bad "坏输入处理异常：$(head -3 "$TMP/bad.log")"

echo ""
echo "  ────────────────────────────────────────────────"
echo "  通过 $PASS · 失败 $FAIL"; echo ""
[ "$FAIL" -eq 0 ] || exit 1
