#!/usr/bin/env node
/**
 * 把 merge.mjs 的核心逻辑原样搬进一个单文件网页，生成 convert.html。
 *
 * 为什么这么做：网页版和命令行版用同一份代码，改一处两边都变，不会出现
 * 「命令行修好了、网页还是旧的」这种分叉。核心段在 merge.mjs 里用
 *   /* @core-start *\/ ... /* @core-end *\/
 * 标出来，这里只做搬运，不重写。
 *
 * 用法：node build-web.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'merge.mjs');
const TPL = path.join(HERE, 'web', 'template.html');
const OUT = path.join(HERE, 'convert.html');

const START = '/* @core-start';
const END = '/* @core-end */';

function fail(msg) {
  console.error('构建失败：' + msg);
  process.exit(1);
}

const merge = fs.readFileSync(SRC, 'utf8');
const i = merge.indexOf(START);
const j = merge.indexOf(END);
if (i < 0 || j < 0 || j < i) fail('在 merge.mjs 里找不到 @core-start / @core-end 标记');

// 起始标记那行是普通行注释，整行跳过
const afterStart = merge.indexOf('\n', i);
let core = merge.slice(afterStart + 1, j);

// 网页里不能出现 Node 专属 API，出现就说明有人把服务端代码写进核心段了
const forbidden = [
  [/\bprocess\.(argv|env|exit|cwd|stdout|stderr)\b/, 'process.*'],
  [/\b(fs|path)\.[a-zA-Z]/, 'fs.* / path.*'],
  [/from\s+['"]node:/, "from 'node:*'"],
  [/^\s*import\s+[^(]/m, '顶层 import'],
  [/^\s*export\s+/m, '顶层 export'],
  [/\brequire\s*\(/, 'require()'],
  [/\b__dirname\b|\b__filename\b/, '__dirname / __filename'],
  [/\bHERE\b/, 'HERE（Node 路径变量）'],
];
for (const [re, label] of forbidden) {
  const m = core.match(re);
  if (m) {
    const line = core.slice(0, m.index).split('\n').length;
    fail(`核心段第 ${line} 行用到了浏览器里没有的 ${label}：${m[0]}`);
  }
}

const tpl = fs.readFileSync(TPL, 'utf8');
if (!tpl.includes('/*CORE*/')) fail('web/template.html 里找不到 /*CORE*/ 占位符');

const coreLines = core.split('\n').length;
const banner = `/* ==== 核心逻辑：与 merge.mjs 同源，共 ${coreLines} 行，勿手改本段 ==== */\n`;
const html = tpl.replace('/*CORE*/', () => banner + core.trimEnd());

fs.writeFileSync(OUT, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`核心段：${coreLines} 行 / ${kb(Buffer.byteLength(core))}`);
console.log(`模板  ：${tpl.split('\n').length} 行 / ${kb(Buffer.byteLength(tpl))}`);
console.log(`输出  ：${path.relative(HERE, OUT)} / ${kb(Buffer.byteLength(html))}`);
