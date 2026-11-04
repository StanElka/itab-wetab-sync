#!/usr/bin/env node
/**
 * 自检：node selftest.mjs
 * 用一份仿真的 WeTab 导出 + 本机真实的 iTab 导出（找不到就用仿真的），
 * 跑一遍两个方向的「语义合并」，逐条断言结果对不对。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  urlKey, hexToRgba, rgbaToHex, itabId, wetabId,
  topicOfName, topicOfItabGroup, topicOfWetabCategory,
  buildWetabFile, buildItabFile, validateWetabFile, validateItabFile, newStats,
} from './merge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.now();

let pass = 0;
const fails = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return; }
  fails.push(label + (extra !== undefined ? `  →  ${JSON.stringify(extra)}` : ''));
}

/* ------------------------------ 测试数据 ------------------------------ */

const site = (name, target, origin = 'online') => ({
  name, target, type: 'site', bgType: 'image', bgColor: 'rgba(0, 0, 0, 0)',
  bgImage: 'https://infinityicon.infinitynewtab.com/user-share-icon/abc.png', origin, id: wetabId('icon-'), updateTime: 0,
});
const colorSite = (name, target, text = name.slice(0, 2)) => ({
  name, target, type: 'site', bgType: 'color', bgText: text, bgColor: 'rgba(194, 194, 194, 1)',
  origin: 'popup', id: wetabId('icon-'), updateTime: 0,
});
const folder = (name, children) => ({
  id: wetabId('folder-'), origin: 'add', type: 'folder-icon', name, folderSize: 'medium', updateTime: 0, children,
});

function syntheticWetab() {
  return {
    version: '2.2.50', branch: 'zh', platform: 'edge', timestamp: NOW,
    data: {
      'store-wallpaper': { wallpaper: 'https://example.org/w.jpg', updateCloudTime: NOW - 1000 },
      'store-search': { searchEngine: 'baidu', updateCloudTime: NOW - 1000 },
      'store-setting': { lang: 'zh', updateCloudTime: NOW - 1000 },
      'store-icon': {
        icons: [
          {
            id: 'category-main', iconClass: 'icon-zhuye', name: '主页', updateTime: 0,
            children: [
              site('哔哩哔哩', 'https://www.bilibili.com/'),
              colorSite('淘宝', 'https://www.taobao.com/'),
              folder('常用', [site('内网面板', 'https://tools.example.org/dashboard', 'online')]),
              { type: 'widget', name: '日历', widgetSize: 'm', widgetName: 'widget-calendar', origin: 'add', id: wetabId('icon-'), updateTime: 0 },
            ],
          },
          {
            id: 'category-code', iconClass: 'icon-chengxu', name: '程序', updateTime: 0,
            children: [colorSite('GitHub', 'https://github.com/', 'GH')],
          },
          {
            id: 'category-ent', iconClass: 'icon-yule', name: '娱乐', updateTime: 0,
            children: [site('壁纸站', 'https://haowallpaper.com/')],
          },
          {
            id: 'category-read', iconClass: 'icon-yuedu', name: '阅读', updateTime: 0,
            children: [site('面试鸭', 'https://www.mianshiya.com/', 'popup')],
          },
          // 这两个分区是 WeTab 随安装附带的推荐站点，转到 iTab 时应被跳过
          {
            id: 'category-shop', iconClass: 'icon-gouwu', name: '购物', updateTime: 0,
            children: [
              site('Amazon', 'https://inftab.com/amazon/', '622af28e7c5d1e54a2d12700'),
              site('当当', 'http://union.dangdang.com/transfer.php', '622af28e7c5d1e54a2d12700'),
            ],
          },
          {
            id: 'category-sys', iconClass: 'icon-gongju', name: '工具', updateTime: 0,
            children: [site('书签', 'chrome://bookmarks/')],
          },
        ],
        dockIdList: ['dock-1'],
        aiCateUserDecided: false,
        updateCloudTime: NOW - 1000,
      },
    },
  };
}

const itabIcon = (name, url, opts = {}) => {
  const it = {
    id: itabId(), type: opts.type || 'icon', name, url,
    backgroundColor: opts.backgroundColor || '#ff5c00',
    size: '1x1', pos: '',
  };
  if (it.type === 'icon') it.src = opts.src || 'https://files.itab.link/icons/x.svg';
  if (opts.iconText) it.iconText = opts.iconText;
  return it;
};

function syntheticItab() {
  return {
    baseConfig: { searchEngine: 'bing' },
    navConfig: [
      {
        id: 'grp-home', name: '主页', icon: 'home',
        children: [
          itabIcon('B站', 'https://www.bilibili.com'),        // 与 WeTab 重复
          itabIcon('知乎', 'https://www.zhihu.com'),
          itabIcon('贴吧', 'https://tieba.baidu.com', { type: 'text', iconText: '贴吧' }),
          { id: itabId(), type: 'component', component: 'weather', name: '天气', size: '2x2', src: 'https://files.itab.link/tools-icon/weather.svg', pos: '' },
        ],
      },
      {
        id: 'grp-code', name: '编程', icon: 'code',
        children: [itabIcon('GitHub', 'https://github.com'), itabIcon('Stack Overflow', 'https://stackoverflow.com')],
      },
      {
        id: 'grp-ai', name: 'AI', icon: 'ApiApp',
        children: [itabIcon('ChatGPT', 'https://chatgpt.com'), itabIcon('Claude', 'https://claude.ai')],
      },
      {
        id: 'grp-folder', name: '收藏夹', icon: 'collect',
        children: [
          { id: itabId(), name: '工具站', size: '2x2', type: 'folder', children: [itabIcon('JSON 工具', 'https://json.example.org')] },
        ],
      },
    ],
  };
}

/** 找本机真实 iTab 导出（主断言用仿真数据，真实数据只做一遍兼容性冒烟） */
function findRealItab() {
  const cands = [
    path.join(HERE, 'in', 'itab.json'),
    path.join(HERE, '..', '_itab-wetab', 'auto', 'raw', 'itab-base.itabdata'),
  ];
  for (const p of cands) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(j.navConfig) && j.navConfig.length) return { data: j, path: p };
    } catch {}
  }
  return null;
}

/* ------------------------------ 断言 ------------------------------ */

const wetab = syntheticWetab();
const itab = syntheticItab();   // 断言用仿真数据，结果确定、换机器也一样
const realItab = findRealItab();
if (realItab) console.log('发现真实 iTab 导出（只用于兼容性冒烟）：', realItab.path);
const wetabOrig = JSON.parse(JSON.stringify(wetab));
const itabOrig = JSON.parse(JSON.stringify(itab));

/* 1. 校验器自身 */
ok(validateWetabFile(wetab).length === 0, '仿真 WeTab 样本本身应通过校验', validateWetabFile(wetab).slice(0, 3));
ok(validateItabFile(syntheticItab()).length === 0, '仿真 iTab 样本本身应通过校验', validateItabFile(syntheticItab()).slice(0, 3));

/* 2. iTab → WeTab 语义合并 */
const statsW = newStats();
const rW = buildWetabFile(wetab, itab, {}, statsW);
const outW = rW.file;
ok(validateWetabFile(outW).length === 0, '生成的 WeTab 文件应通过校验', validateWetabFile(outW).slice(0, 3));

for (const key of ['store-wallpaper', 'store-search', 'store-setting']) {
  ok(JSON.stringify(outW.data[key]) === JSON.stringify(wetabOrig.data[key]), `其它 store 不能被改动：${key}`);
}
const icons = outW.data['store-icon'].icons;
const mainCat = icons.find((c) => c.name === '主页');
ok(!!mainCat, '原有的「主页」分区应保留');
ok(mainCat.children.some((c) => c.name === '哔哩哔哩'), '原有图标应保留');
ok(mainCat.children.some((c) => c.type === 'widget'), 'WeTab 小组件应原样保留');

const zhihu = mainCat.children.find((c) => c.target && c.target.includes('zhihu'));
ok(!!zhihu, 'iTab 的知乎应并进 WeTab「主页」');
ok(mainCat.children.filter((c) => c.target && urlKey(c.target) === 'bilibili.com').length === 1, '重复的 B 站不应加第二遍');
ok(!mainCat.children.some((c) => c.type === 'component'), 'iTab 的天气小部件不应进 WeTab');

const codeCat = icons.find((c) => c.name === '程序');
ok(!!codeCat && codeCat.children.some((c) => String(c.target).includes('stackoverflow')), 'iTab 的 Stack Overflow 应并进「程序」');
ok(codeCat.children.filter((c) => urlKey(c.target) === 'github.com').length === 1, 'GitHub 两遍重复只应留一份');

const aiCat = icons.find((c) => c.name === 'AI');
ok(!!aiCat, 'iTab 的「AI」应新建成分区');
ok(aiCat && aiCat.iconClass === 'icon-ai', '「AI」分区的图标应是 icon-ai', aiCat?.iconClass);
ok(!icons.some((c) => /（iTab）/.test(c.name)), '默认不应出现「（iTab）」后缀的分区');
ok(rW.created === 2, '应只新建 2 个分区（AI、收藏夹）', { created: rW.created, merged: rW.merged });

const tieba = mainCat.children.find((c) => c.target && c.target.includes('tieba'));
ok(tieba && tieba.bgType === 'color' && tieba.bgText === '贴吧', 'iTab 文字图标应转成 bgType:color + bgText', tieba);

const favCat = icons.find((c) => c.name === '收藏夹');
ok(favCat && favCat.children.some((c) => c.type === 'folder-icon' && c.children.length === 1), 'iTab 文件夹应转成 folder-icon');

{
  const ids = [];
  const walk = (arr) => arr.forEach((x) => { ids.push(x.id); if (x.children) walk(x.children); });
  icons.forEach((c) => { ids.push(c.id); walk(c.children); });
  ok(new Set(ids).size === ids.length, '生成的 id 应唯一', ids.length - new Set(ids).size);
  ok(ids.every((id) => /^(icon|folder|category)-[a-z0-9]+$/i.test(id)), '生成的 id 格式应与 WeTab 一致');
}

ok(outW.data['store-icon'].updateCloudTime === NOW || outW.data['store-icon'].updateCloudTime > wetabOrig.data['store-icon'].updateCloudTime, 'updateCloudTime 应刷新');

/* 3. 幂等 */
const statsW2 = newStats();
buildWetabFile(outW, itab, {}, statsW2);
ok(statsW2.addedToWetab === 0, '再跑一次不应新增（按网址去重）', { added: statsW2.addedToWetab });

/* 4. WeTab → iTab 语义合并 */
const statsI = newStats();
const rI = buildItabFile(itab, wetab, {}, statsI);
const outI = rI.file;
ok(validateItabFile(outI).length === 0, '生成的 iTab 文件应通过校验', validateItabFile(outI).slice(0, 3));
ok(JSON.stringify(outI.baseConfig) === JSON.stringify(itabOrig.baseConfig), 'baseConfig 不能被改动');
ok(outI.navConfig.length >= itabOrig.navConfig.length, '原有分组应保留');

ok(outI.navConfig.some((g) => g.children.some((c) => String(c.url).includes('haowallpaper'))), 'WeTab 的壁纸站应进 iTab');
ok(!outI.navConfig.some((g) => g.children.some((c) => /inftab|dangdang/.test(c.url || ''))), 'WeTab 自带的推荐站点不应搬进 iTab');
ok(!outI.navConfig.some((g) => g.children.some((c) => /^chrome:/.test(c.url || ''))), 'chrome:// 系统页不应搬进 iTab');

const newRead = outI.navConfig.find((g) => g.name === '阅读');
ok(!!newRead, '主题对不上时在 iTab 侧新建「阅读」分组', outI.navConfig.map((g) => g.name));
ok(newRead && newRead.icon === 'read', '「阅读」分组图标应为 read', newRead?.icon);
ok(newRead && newRead.children.some((c) => String(c.url).includes('mianshiya')), '「阅读」里应有面试鸭');

for (const g of outI.navConfig) {
  for (const c of g.children) {
    if (String(c.url || '').includes('taobao')) {
      ok(c.type === 'text' && c.iconText === '淘宝', 'WeTab 纯色站点应转成 iTab 文字图标', c);
      ok(/^#[0-9a-f]{6}$/i.test(c.backgroundColor), '背景色应转成 hex', c.backgroundColor);
    }
  }
}
ok(!outI.navConfig.some((g) => /（WeTab）/.test(g.name)), '默认不应出现「（WeTab）」后缀的分组');

/* 5. --append 旧模式 */
const statsA = newStats();
const rA = buildWetabFile(wetab, itab, { append: true }, statsA);
ok(rA.file.data['store-icon'].icons.some((c) => /（iTab）$/.test(c.name)), '--append 模式应产生「（iTab）」分区');
ok(rA.merged === 0, '--append 模式不应并入现有分区', { merged: rA.merged });

/* 6. 主题推断 & 工具函数 */
ok(topicOfName('人工智能') === 'ai', '「人工智能」应归到 ai');
ok(topicOfName('摸鱼') === 'entertainment', '「摸鱼」应归到 entertainment');
ok(topicOfName('购物') === 'shop', '「购物」应归到 shop');
ok(topicOfItabGroup({ name: 'AI', icon: 'ApiApp' }) === 'ai', 'iTab 的 AI 分组（名字优先）应归到 ai');
ok(topicOfWetabCategory({ name: '程序', iconClass: 'icon-chengxu' }) === 'code', 'WeTab「程序」应归到 code');
ok(topicOfWetabCategory({ name: '不认识', iconClass: 'icon-jianzhu' }) === 'other', '认不出的分区应归到 other');
ok(hexToRgba('#ff5c00') === 'rgba(255, 92, 0, 1)', 'hex → rgba');
ok(rgbaToHex('rgba(194, 194, 194, 1)') === '#c2c2c2', 'rgba → hex');
ok(urlKey('https://www.Bilibili.com/video/1/?utm_source=x#t=3') === 'bilibili.com/video/1', '网址归一化应去掉协议/www/锚点/跟踪参数');

/* 7. 真实 iTab 数据冒烟：跑得通、结构合法、不报错 */
let realLine = '';
if (realItab) {
  try {
    const s1 = newStats();
    const realW = buildWetabFile(wetab, realItab.data, {}, s1);
    const s2 = newStats();
    const realI = buildItabFile(realItab.data, wetab, {}, s2);
    ok(validateWetabFile(realW.file).length === 0, '真实 iTab 数据 → WeTab 文件应通过校验', validateWetabFile(realW.file).slice(0, 3));
    ok(validateItabFile(realI.file).length === 0, '真实 iTab 数据 → iTab 文件应通过校验', validateItabFile(realI.file).slice(0, 3));
    realLine = `真实数据：iTab ${realItab.data.navConfig.length} 组 → WeTab 并入 ${s1.addedToWetab} 条（新建 ${realW.created} 个分区），反向并入 ${s2.addedToItab} 条`;
  } catch (e) {
    ok(false, '真实 iTab 数据跑通不应抛异常', e.message);
  }
} else {
  realLine = '（本机没找到真实 iTab 导出，跳过真实数据冒烟）';
}

/* ------------------------------ 结果 ------------------------------ */
console.log('');
if (fails.length) {
  console.log(`❌ ${fails.length} 项不通过：`);
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log(`全部通过：${pass} 项断言 ✔`);
  console.log('');
  console.log(`（仿真：iTab ${itab.navConfig.length} 组 → WeTab 新建 ${rW.created} 个分区 / 并入 ${rW.merged} 个现有分区，共 ${statsW.addedToWetab} 条）`);
  console.log(`（反向：WeTab → iTab 新建 ${rI.created} 个分组 / 并入 ${rI.merged} 个现有分组，共 ${statsI.addedToItab} 条）`);
  console.log(`（${realLine}）`);
}
