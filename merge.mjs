#!/usr/bin/env node
/**
 * iTab (Chrome) ⇄ WeTab (Edge) 图标数据互通转换器
 *
 * 默认行为：语义合并 —— 按「主题」把一边的分组/分区并进另一边已有的同类分区，
 * 只有实在对不上时才新建一个（用正规名字和正规图标），不会产生
 * 「主页（iTab）」「编程（iTab）」这种平行的重复分区。
 *
 * 旧行为（整块追加 + 名字加后缀）保留在 --append 开关里。
 *
 * 纯本地、零依赖，只处理两个扩展自己导出的 JSON。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* @core-start —— 以下为纯逻辑核心，不含任何 Node API，build-web.mjs 会原样搬进网页版 */
const NOW = Date.now();

/* ============================== 基础工具 ============================== */

/** WeTab 的 id：前缀 + 毫秒36进制 + 18 位小写字母数字（与官方 kb() 同构） */
function wetabId(prefix = '') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = prefix + NOW.toString(32);
  for (let i = 0; i < 18; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** iTab 的 id：21 位 [A-Za-z0-9-_] */
function itabId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < 21; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** 按字符截断（不切坏 emoji 代理对） */
function clampText(s, max) {
  const a = Array.from(String(s ?? ''));
  return a.length > max ? a.slice(0, max).join('') : a.join('');
}

/** 网址归一化：判断「是不是同一个网站」用 */
function urlKey(raw) {
  let u = String(raw ?? '').trim();
  if (!u) return '';
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  u = u.replace(/^www\./i, '');
  u = u.split('#')[0];
  const [pathPart, query = ''] = u.split('?');
  let p = pathPart;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const drop = /^(utm_|from$|ref$|spm$|share_token$|_t$|vfm$|promotionchannel$|fbclid$|gclid$|scm$|s_cid$|pvid$|vd_source$)/i;
  const keep = query
    .split('&')
    .filter(Boolean)
    .filter((kv) => !drop.test(kv.split('=')[0] || ''))
    .sort()
    .join('&');
  return (p + (keep ? '?' + keep : '')).toLowerCase();
}

/** #rrggbb / #rgb / #rrggbbaa → rgba(r, g, b, a) */
function hexToRgba(hex, fallback = 'rgba(194, 194, 194, 1)') {
  const c = String(hex ?? '').trim();
  if (/^rgba?\(/i.test(c)) return c;
  let h = c.replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(h) || (h.length !== 3 && h.length !== 4 && h.length !== 6 && h.length !== 8)) return fallback;
  if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** rgba(...) → #rrggbb */
function rgbaToHex(color, fallback = '#cccccc') {
  if (!color) return fallback;
  const c = String(color).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
  if (!m) return fallback;
  const h = (n) => Math.max(0, Math.min(255, Math.round(+n))).toString(16).padStart(2, '0');
  return '#' + h(m[1]) + h(m[2]) + h(m[3]);
}

/** 去掉七牛缩略图参数（渲染时会自动加，存下来会让图片失效） */
const cleanImageUrl = (u) => String(u ?? '').replace(/\?(imageMogr2|imageView2)[^"')\s]*/gi, '');

const deepClone = (x) => JSON.parse(JSON.stringify(x));

/* ============================== 主题体系 ==============================
 * 两边分区的组织习惯不一样，用一层「主题 topic」做中间语言：
 *   一边的某个分组 → 先猜主题 → 到另一边找主题相同的分区 → 并进去
 * 猜主题的顺序是「名字关键词优先，其次看图标」，因为用户给分组起的名字
 * 往往比图标更贴近他心里的分类（比如叫「AI」的分组用的是科技图标）。
 */

// 主题 → WeTab 分区图标 class（WeTab 只有这 29 个 icon-* 可选）
const TOPIC_WETAB_CLASS = {
  home: 'icon-zhuye',
  code: 'icon-chengxu',
  tool: 'icon-gongju',
  ai: 'icon-ai',
  tech: 'icon-keji',
  read: 'icon-yuedu',
  learn: 'icon-yuedu',
  news: 'icon-zixun',
  shop: 'icon-gouwu',
  entertainment: 'icon-yule',
  movie: 'icon-dianying',
  music: 'icon-yinle',
  game: 'icon-yule',
  social: 'icon-shejiao',
  design: 'icon-sheji',
  product: 'icon-chanpin',
  travel: 'icon-lvyou',
  finance: 'icon-jinrong',
  food: 'icon-canyin',
  health: 'icon-jiankang',
  sport: 'icon-jianshen',
  photo: 'icon-tupian',
  app: 'icon-gongju',
  like: 'icon-gongju',
  other: 'icon-gongju',
};

// WeTab 分区图标 class → 主题
const WETAB_CLASS_TOPIC = {
  'icon-zhuye': 'home',
  'icon-chengxu': 'code',
  'icon-gongju': 'tool',
  'icon-ai': 'ai',
  'icon-keji': 'tech',
  'icon-yuedu': 'read',
  'icon-zixun': 'news',
  'icon-gouwu': 'shop',
  'icon-yule': 'entertainment',
  'icon-dianying': 'movie',
  'icon-yinle': 'music',
  'icon-shejiao': 'social',
  'icon-sheji': 'design',
  'icon-chuangyi': 'design',
  'icon-huihua': 'design',
  'icon-chanpin': 'product',
  'icon-lvyou': 'travel',
  'icon-dili': 'travel',
  'icon-qiche': 'travel',
  'icon-jinrong': 'finance',
  'icon-canyin': 'food',
  'icon-jiankang': 'health',
  'icon-jianshen': 'sport',
  'icon-tiyu': 'sport',
  'icon-sheying': 'photo',
  'icon-tupian': 'photo',
  'icon-tianwen': 'tech',
  'icon-wangluo': 'tech',
  'icon-jianzhu': 'other',
};

// iTab 分组图标名 → 主题（iTab 的 28 个官方预设，见 HomeNavGroup 的图标表）
const ITAB_ICON_TOPIC = {
  home: 'home',
  xin: 'home',
  music: 'music',
  chat: 'social',
  office: 'tool',
  entertainment: 'entertainment',
  shop: 'shop',
  app: 'app',
  code: 'code',
  learn: 'learn',
  read: 'read',
  tool: 'tool',
  zan: 'like',
  collect: 'like',
  apiapp: 'tech',
  plane: 'travel',
  planet: 'tech',
  apps: 'app',
  darw: 'design',
  leaf: 'other',
  photo: 'photo',
  award: 'like',
  fitness: 'health',
  producthunt: 'product',
  telegram: 'product',
  flag: 'other',
  bookmark: 'like',
  bucket: 'other',
};

// 主题 → iTab 分组图标名（只选 iTab 官方预设里确实存在的）
const TOPIC_ITAB_ICON = {
  home: 'home',
  code: 'code',
  tool: 'office',
  ai: 'ApiApp',
  tech: 'ApiApp',
  read: 'read',
  learn: 'learn',
  news: 'read',
  shop: 'shop',
  entertainment: 'entertainment',
  movie: 'entertainment',
  music: 'music',
  game: 'entertainment',
  social: 'chat',
  design: 'Darw',
  product: 'Producthunt',
  travel: 'Plane',
  finance: 'Award',
  food: 'shop',
  health: 'fitness',
  sport: 'fitness',
  photo: 'Photo',
  app: 'app',
  like: 'zan',
  other: 'Apps',
};

// 分组名字里的关键词 → 主题（顺序有讲究：越具体的排越前）
const NAME_TOPIC_RULES = [
  [/人工智能|大模型|ai工具|智能助手|chatgpt|deepseek|claude|gemini|\bgpt\b|豆包|通义|文心|kimi|(?:^|[^a-z])ai(?:$|[^a-z])/i, 'ai'],
  [/编程|代码|开发|程序|技术|code|dev|github|开源/i, 'code'],
  [/办公|文档|效率|office|工作台|协作/i, 'tool'],
  [/设计|素材|灵感|创意|design|figma|dribbble/i, 'design'],
  [/产品|product|\bpm\b|需求/i, 'product'],
  [/阅读|读书|小说|图书|书签|read|book/i, 'read'],
  [/购物|商城|淘宝|京东|买|shop|mall/i, 'shop'],
  [/音乐|music|歌|网易云|spotify/i, 'music'],
  [/影视|电影|视频|追剧|动漫|movie|video|bilibili|哔哩/i, 'movie'],
  [/摸鱼|娱乐|游戏|搞笑|放松|fun|game|play/i, 'entertainment'],
  [/资讯|新闻|热点|news/i, 'news'],
  [/社交|聊天|社区|论坛|social|chat/i, 'social'],
  [/科技|数码|tech|极客|硬件/i, 'tech'],
  [/金融|股票|投资|理财|finance|stock|crypto/i, 'finance'],
  [/旅游|出行|地图|机票|酒店|travel|trip/i, 'travel'],
  [/餐饮|美食|外卖|food|eat/i, 'food'],
  [/健康|医疗|health/i, 'health'],
  [/健身|运动|sport|fitness|跑步/i, 'sport'],
  [/学习|教育|课程|教程|learn|edu|study/i, 'learn'],
  [/图片|摄影|图库|photo|image|wallpaper/i, 'photo'],
  [/工具|tool|效率/i, 'tool'],
  [/主页|首页|常用|起始|home|start/i, 'home'],
  [/喜欢|收藏|稍后|like|favorite/i, 'like'],
];

/** 从分组/分区名字猜主题 */
function topicOfName(name) {
  const n = String(name ?? '');
  if (!n.trim()) return null;
  for (const [re, topic] of NAME_TOPIC_RULES) if (re.test(n)) return topic;
  return null;
}

/** iTab 分组 → 主题（名字优先，其次图标） */
function topicOfItabGroup(group) {
  return topicOfName(group?.name) ?? ITAB_ICON_TOPIC[String(group?.icon ?? '').toLowerCase()] ?? 'other';
}

/** WeTab 分区 → 主题（名字优先，其次图标） */
function topicOfWetabCategory(cat) {
  return topicOfName(cat?.name) ?? WETAB_CLASS_TOPIC[String(cat?.iconClass ?? '')] ?? 'other';
}

const wetabClassForTopic = (topic) => TOPIC_WETAB_CLASS[topic] ?? 'icon-gongju';
const itabIconForTopic = (topic) => TOPIC_ITAB_ICON[topic] ?? 'Apps';

/* ======================= iTab 项 → WeTab 项 ======================= */

const ZERO_BG = 'rgba(0, 0, 0, 0)';

/** WeTab 随安装附带的推荐站点，origin 都带着这批预置数据的批次前缀 */
const WETAB_PRESET_ORIGIN_RE = /^622af28e[0-9a-f]{16}$/;

/** iTab 的一个站点/文字图标 → WeTab 的 site 对象；转不了返回 null */
function itabItemToWetabSite(item) {
  const url = String(item?.url ?? '').trim();
  if (!url) return null;
  const name = clampText(item.name || url, 60);
  const site = { id: wetabId('icon-'), name, target: url, type: 'site', updateTime: NOW };
  const src = String(item.src ?? '').trim();
  if (item.type === 'text' || !src) {
    site.bgType = 'color';
    site.bgText = clampText(item.iconText || name, 2);
    site.bgColor = hexToRgba(item.backgroundColor);
  } else {
    site.bgType = 'image';
    site.bgImage = cleanImageUrl(src);
    site.bgColor = ZERO_BG;
  }
  site.origin = site.id;
  return site;
}

/** iTab 的文件夹 → WeTab 的 folder-icon；子项全部转不了返回 null */
function itabFolderToWetabFolder(item, seenUrls, stats) {
  const children = [];
  for (const child of item?.children ?? []) {
    const url = String(child?.url ?? '').trim();
    if (!url) continue;
    const key = urlKey(url);
    if (seenUrls.has(key)) {
      stats.duplicates++;
      continue;
    }
    const site = itabItemToWetabSite(child);
    if (!site) continue;
    seenUrls.add(key);
    children.push(site);
  }
  if (!children.length) return null;
  return {
    id: wetabId('folder-'),
    name: clampText(item.name || '文件夹', 30),
    type: 'folder-icon',
    folderSize: 'medium',
    origin: 'add',
    updateTime: NOW,
    children,
  };
}

/** iTab 一个分组 → 一串 WeTab 子项（site 或 folder-icon） */
function itabGroupToWetabItems(group, seenUrls, stats) {
  const out = [];
  for (const item of group?.children ?? []) {
    const type = String(item?.type ?? '');
    if (type === 'component') {
      stats.skippedComponents++;
      continue;
    }
    if (type === 'folder') {
      const folder = itabFolderToWetabFolder(item, seenUrls, stats);
      if (folder) out.push(folder);
      continue;
    }
    const url = String(item?.url ?? '').trim();
    if (!url) continue;
    const key = urlKey(url);
    if (seenUrls.has(key)) {
      stats.duplicates++;
      continue;
    }
    const site = itabItemToWetabSite(item);
    if (!site) continue;
    seenUrls.add(key);
    out.push(site);
  }
  return out;
}

/* ======================= WeTab 项 → iTab 项 ======================= */

/** WeTab 的 site → iTab 的图标项；转不了返回 null */
function wetabSiteToItabItem(site) {
  const url = String(site?.target ?? '').trim();
  if (!url) return null;
  const name = clampText(site.name || url, 60);
  const bgImage = String(site.bgImage ?? '').trim();
  if (site.bgType === 'image' && bgImage) {
    return {
      id: itabId(),
      name,
      url,
      type: 'icon',
      src: cleanImageUrl(bgImage),
      backgroundColor: rgbaToHex(site.bgColor),
      size: '1x1',
    };
  }
  return {
    id: itabId(),
    name,
    url,
    type: 'text',
    iconText: clampText(site.bgText || name, 2),
    backgroundColor: rgbaToHex(site.bgColor),
    size: '1x1',
  };
}

/** WeTab 的 folder-icon → iTab 的文件夹；子项全部转不了返回 null */
function wetabFolderToItabFolder(item, seenUrls, stats) {
  const children = [];
  for (const child of item?.children ?? []) {
    const target = String(child?.target ?? '');
    if (!/^https?:/i.test(target)) {
      stats.skippedSystemLinks++;
      continue;
    }
    if (WETAB_PRESET_ORIGIN_RE.test(String(child?.origin ?? ''))) {
      stats.skippedPresets++;
      continue;
    }
    const it = wetabSiteToItabItem(child);
    if (!it) continue;
    const key = urlKey(it.url);
    if (seenUrls.has(key)) {
      stats.duplicates++;
      continue;
    }
    seenUrls.add(key);
    children.push(it);
  }
  if (!children.length) return null;
  return {
    id: itabId(),
    name: clampText(item.name || '文件夹', 30),
    size: '2x2',
    type: 'folder',
    children,
  };
}

/** WeTab 一个分区 → 一串 iTab 子项 */
function wetabCategoryToItabItems(cat, seenUrls, stats) {
  const out = [];
  for (const child of cat?.children ?? []) {
    const type = String(child?.type ?? '');
    if (type === 'widget') {
      stats.skippedWidgets++;
      continue;
    }
    if (type === 'folder-icon') {
      const folder = wetabFolderToItabFolder(child, seenUrls, stats);
      if (folder) out.push(folder);
      continue;
    }
    if (type !== 'site') continue;
    const target = String(child?.target ?? '');
    // WeTab 内置的快捷入口（书签/历史记录等）在 iTab 里没有对应页面，搬过去打不开
    if (!/^https?:/i.test(target)) {
      stats.skippedSystemLinks++;
      continue;
    }
    // origin 以 622af28e 开头 = WeTab 随安装附带的「推荐站点」预置数据，不是用户自己加的
    if (WETAB_PRESET_ORIGIN_RE.test(String(child?.origin ?? ''))) {
      stats.skippedPresets++;
      continue;
    }
    const it = wetabSiteToItabItem(child);
    if (!it) continue;
    const key = urlKey(it.url);
    if (seenUrls.has(key)) {
      stats.duplicates++;
      continue;
    }
    seenUrls.add(key);
    out.push(it);
  }
  return out;
}

/* ============================== 收集网址 ============================== */

/** WeTab 装好数据里已存在的全部网址（含文件夹内的） */
function collectWetabUrls(icons) {
  const seen = new Set();
  const eat = (arr) => {
    for (const it of arr ?? []) {
      if (it?.type === 'site' && it.target) seen.add(urlKey(it.target));
      else if (it?.type === 'folder-icon') eat(it.children);
    }
  };
  for (const cat of icons ?? []) eat(cat?.children);
  return seen;
}

/** iTab 数据里已存在的全部网址（含文件夹内的） */
function collectItabUrls(navConfig) {
  const seen = new Set();
  const eat = (arr) => {
    for (const it of arr ?? []) {
      if (it?.url) seen.add(urlKey(it.url));
      else if (it?.type === 'folder') eat(it.children);
    }
  };
  for (const g of navConfig ?? []) eat(g?.children);
  return seen;
}

/* ============================== 生成文件 ============================== */

function newStats() {
  return {
    addedToWetab: 0,
    addedToItab: 0,
    duplicates: 0,
    skippedComponents: 0,
    skippedWidgets: 0,
    skippedPresets: 0,
    skippedSystemLinks: 0,
    mapping: [], // {方向, 来源, 主题, 目标, 方式, 条数}
  };
}

/** 生成「给 WeTab 导入」的文件：以 WeTab 自己的导出为底稿，只改 store-icon */
function buildWetabFile(wetabExport, itabExport, opts, stats) {
  const base = wetabExport ? deepClone(wetabExport) : { version: '2.2.50', branch: 'zh', platform: 'edge', timestamp: NOW, data: {} };
  base.data = base.data ?? {};
  const icon = (base.data['store-icon'] = base.data['store-icon'] ?? {});
  icon.icons = Array.isArray(icon.icons) ? icon.icons : [];
  icon.dockIdList = Array.isArray(icon.dockIdList) ? icon.dockIdList : [];
  for (const cat of icon.icons) cat.children = Array.isArray(cat.children) ? cat.children : [];

  const seen = collectWetabUrls(icon.icons);
  const tag = opts.tag ?? (opts.append ? '（iTab）' : '');
  let created = 0;
  let merged = 0;

  for (const group of itabExport?.navConfig ?? []) {
    const items = itabGroupToWetabItems(group, seen, stats);
    if (!items.length) continue;
    const topic = topicOfItabGroup(group);
    let target = null;
    let how = '';
    if (!opts.append) {
      target = icon.icons.find((c) => topicOfWetabCategory(c) === topic) ?? null;
      if (target) {
        how = '并入现有分区';
        merged++;
      }
    }
    if (!target) {
      const name = clampText(group.name || '未命名', 30) + tag;
      target = {
        id: wetabId('category-'),
        iconClass: wetabClassForTopic(topic),
        name,
        updateTime: NOW,
        children: [],
      };
      icon.icons.push(target);
      how = '新建分区';
      created++;
    }
    target.children.push(...items);
    target.updateTime = NOW;
    stats.addedToWetab += items.length;
    stats.mapping.push({ side: 'wetab', from: group.name || '未命名', topic, to: target.name, how, count: items.length });
  }

  icon.updateCloudTime = NOW;
  base.timestamp = NOW;
  return { file: base, created, merged };
}

/** 生成「给 iTab 导入」的文件：以 iTab 自己的导出为底稿，只往 navConfig 里并 */
function buildItabFile(itabExport, wetabExport, opts, stats) {
  const base = itabExport ? deepClone(itabExport) : { baseConfig: {}, navConfig: [] };
  base.navConfig = Array.isArray(base.navConfig) ? base.navConfig : [];
  for (const g of base.navConfig) g.children = Array.isArray(g.children) ? g.children : [];

  const seen = collectItabUrls(base.navConfig);
  const tag = opts.tag ?? (opts.append ? '（WeTab）' : '');
  const byTopic = new Map();
  for (const g of base.navConfig) {
    const t = topicOfItabGroup(g);
    if (!byTopic.has(t)) byTopic.set(t, g);
  }
  let created = 0;
  let merged = 0;
  const cats = wetabExport?.data?.['store-icon']?.icons ?? [];

  for (const cat of cats) {
    const items = wetabCategoryToItabItems(cat, seen, stats);
    if (!items.length) continue;
    const topic = topicOfWetabCategory(cat);
    let target = opts.append ? null : byTopic.get(topic) ?? null;
    let how = '';
    if (target) {
      how = '并入现有分组';
      merged++;
    } else {
      const name = clampText(cat.name || '未命名', 30) + tag;
      target = { id: itabId(), name, icon: itabIconForTopic(topic), children: [] };
      base.navConfig.push(target);
      byTopic.set(topic, target);
      how = '新建分组';
      created++;
    }
    target.children.push(...items);
    stats.addedToItab += items.length;
    stats.mapping.push({ side: 'itab', from: cat.name || '未命名', topic, to: target.name, how, count: items.length });
  }

  return { file: base, created, merged };
}

/* ============================== 校验 ============================== */

const WETAB_ID_RE = /^(icon|folder|category|widget)-[a-z0-9]+$/i;
const ITAB_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

/** 校验生成的 WeTab 文件，返回错误列表（空 = 通过） */
function validateWetabFile(file) {
  const errs = [];
  if (!file || typeof file !== 'object') return ['文件不是对象'];
  if (!file.data || typeof file.data !== 'object') errs.push('缺少 data 字段');
  const icon = file.data?.['store-icon'];
  if (!icon) return errs.concat('data 里没有 store-icon');
  if (!Array.isArray(icon.icons)) return errs.concat('store-icon.icons 不是数组');
  if (typeof icon.updateCloudTime !== 'number') errs.push('store-icon 缺少 updateCloudTime');
  if (!Array.isArray(icon.dockIdList)) errs.push('store-icon.dockIdList 不是数组');

  const catIds = new Set();
  const itemIds = new Set();
  const urls = new Map();
  const checkId = (id, kind, where) => {
    if (typeof id !== 'string' || !id) errs.push(`${where} 缺少 id`);
    else if (!WETAB_ID_RE.test(id) && !/^[a-z0-9]{10,}$/i.test(id)) errs.push(`${where} 的 id 格式可疑：${id}`);
    else if (catIds.has(id) || itemIds.has(id)) errs.push(`${where} 的 id 重复：${id}`);
    else (kind === 'category' ? catIds : itemIds).add(id);
  };
  const checkSite = (s, where) => {
    checkId(s.id, 'item', where);
    if (typeof s.name !== 'string') errs.push(`${where} 的 name 不是字符串`);
    if (!s.target || typeof s.target !== 'string') errs.push(`${where} 缺少 target`);
    if (s.type !== 'site') errs.push(`${where} 的 type 不是 site（${s.type}）`);
    if (s.bgType !== 'image' && s.bgType !== 'color') errs.push(`${where} 的 bgType 非法：${s.bgType}`);
    if (s.bgType === 'image' && !s.bgImage) errs.push(`${where} 是 image 但没有 bgImage`);
    if (typeof s.updateTime !== 'number') errs.push(`${where} 缺少 updateTime`);
    if (s.target) {
      const k = urlKey(s.target);
      if (urls.has(k)) errs.push(`网址重复（${where} 与 ${urls.get(k)}）：${s.target}`);
      else urls.set(k, where);
    }
  };

  icon.icons.forEach((cat, ci) => {
    const where = `分区[${ci}]「${cat.name ?? ''}」`;
    checkId(cat.id, 'category', where);
    if (typeof cat.name !== 'string') errs.push(`${where} 的 name 不是字符串`);
    if (cat.iconClass && !/^icon-[a-z]+$/.test(cat.iconClass) && !/^icon-/.test(cat.iconClass)) errs.push(`${where} 的 iconClass 可疑：${cat.iconClass}`);
    if (!Array.isArray(cat.children)) errs.push(`${where} 的 children 不是数组`);
    (cat.children ?? []).forEach((child, ii) => {
      const cw = `${where}.children[${ii}]`;
      if (child?.type === 'site') checkSite(child, cw);
      else if (child?.type === 'folder-icon') {
        checkId(child.id, 'item', cw);
        if (!Array.isArray(child.children)) errs.push(`${cw} 的 children 不是数组`);
        (child.children ?? []).forEach((s, si) => {
          if (s?.type !== 'site') errs.push(`${cw}.children[${si}] 不是 site`);
          else checkSite(s, `${cw}.children[${si}]`);
        });
      } else if (child?.type === 'widget') {
        // 用户原有的小组件：原样保留，不做校验
      } else {
        errs.push(`${cw} 的 type 不认识：${child?.type}`);
      }
    });
  });
  return errs;
}

/** 校验生成的 iTab 文件 */
function validateItabFile(file) {
  const errs = [];
  if (!file || typeof file !== 'object') return ['文件不是对象'];
  if (!Array.isArray(file.navConfig)) return ['navConfig 不是数组'];
  const groupIds = new Set();
  const itemIds = new Set();
  const urls = new Map();

  const checkItem = (it, where) => {
    if (typeof it.id !== 'string' || !it.id) errs.push(`${where} 缺少 id`);
    else if (!ITAB_ID_RE.test(it.id)) errs.push(`${where} 的 id 格式可疑：${it.id}`);
    else if (itemIds.has(it.id)) errs.push(`${where} 的 id 重复：${it.id}`);
    else itemIds.add(it.id);
    if (typeof it.name !== 'string') errs.push(`${where} 的 name 不是字符串`);
    const t = it.type;
    // component = iTab 自己的内置小部件（天气/日历等），用户原有数据，原样保留
    if (t !== 'icon' && t !== 'text' && t !== 'folder' && t !== 'component') errs.push(`${where} 的 type 不认识：${t}`);
    // 内置工具图标（component:bookmarks 之类）可以没有 url
    if (!it.url && !it.component) errs.push(`${where} 缺少 url`);
    if (t === 'icon' && !it.src && !it.component) errs.push(`${where} 是 icon 但没有 src`);
    if (t === 'text' && !it.iconText) errs.push(`${where} 是 text 但没有 iconText`);
    if (it.url) {
      const k = urlKey(it.url);
      if (urls.has(k)) errs.push(`网址重复（${where} 与 ${urls.get(k)}）：${it.url}`);
      else urls.set(k, where);
    }
  };

  file.navConfig.forEach((g, gi) => {
    const where = `分组[${gi}]「${g.name ?? ''}」`;
    if (typeof g.id !== 'string' || !g.id) errs.push(`${where} 缺少 id`);
    else if (groupIds.has(g.id)) errs.push(`${where} 的 id 重复：${g.id}`);
    else groupIds.add(g.id);
    if (typeof g.name !== 'string') errs.push(`${where} 的 name 不是字符串`);
    if (!Array.isArray(g.children)) errs.push(`${where} 的 children 不是数组`);
    (g.children ?? []).forEach((it, ii) => {
      const iw = `${where}.children[${ii}]`;
      if (it?.type === 'folder') {
        if (typeof it.id !== 'string' || !it.id) errs.push(`${iw} 缺少 id`);
        else if (itemIds.has(it.id)) errs.push(`${iw} 的 id 重复：${it.id}`);
        else itemIds.add(it.id);
        if (!Array.isArray(it.children)) errs.push(`${iw} 的 children 不是数组`);
        (it.children ?? []).forEach((c, ci) => checkItem(c, `${iw}.children[${ci}]`));
      } else {
        checkItem(it, iw);
      }
    });
  });
  return errs;
}

/* @core-end */

/* ============================== 命令行 ============================== */

function parseArgs(argv) {
  const opts = { tag: undefined, append: false, oneWay: null, check: false, itab: null, wetab: null, out: path.join(HERE, 'out') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--append': opts.append = true; break;
      case '--tag': opts.tag = next() ?? ''; break;
      case '--no-tag': opts.tag = ''; break;
      case '--one-way': opts.oneWay = (next() || '').toLowerCase(); break;
      case '--check': case '-n': opts.check = true; break;
      case '--itab': opts.itab = next(); break;
      case '--wetab': opts.wetab = next(); break;
      case '--out': opts.out = next(); break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (!a.startsWith('-')) {
          if (/\.itabdata$/i.test(a)) opts.itab = a;
          else if (/\.data$/i.test(a)) opts.wetab = a;
          else if (/\.json$/i.test(a)) { if (!opts.itab) opts.itab = a; else opts.wetab = a; }
          else throw new Error(`看不懂这个参数：${a}`);
        }
    }
  }
  return opts;
}

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`读不了${label}文件：${file}（${e.message}）`);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`${label}文件不是合法 JSON：${file}（${e.message}）`);
  }
}

function findLatest(dir, test) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => test(f))
    .map((f) => {
      const p = path.join(dir, f);
      try { return { p, mtime: fs.statSync(p).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.p ?? null;
}

const HELP = `iTab ⇄ WeTab 图标互通转换器

用法：
  node merge.mjs                       在 ./in 里自动找两边的导出文件，做语义合并
  node merge.mjs --check               只看看会合并成什么样，不写文件
  node merge.mjs --itab <文件.itabdata> --wetab <文件.data>
  node merge.mjs --one-way itab        只生成「给 WeTab 的导入文件」
  node merge.mjs --one-way wetab       只生成「给 iTab 的导入文件」
  node merge.mjs --append              旧模式：整块追加成新分区，名字加后缀
  node merge.mjs --tag "（同步）"      配合 --append 自定义后缀
  node merge.mjs --no-tag              新建分区不加任何后缀
  node merge.mjs --out <目录>          输出目录（默认 ./out）

默认怎么合并：
  把每个分组先归到「主题」（名字关键词优先，其次看图标），
  再到另一边找主题相同的现有分区并进去；找不到同类才新建一个，
  用正规名字和正规图标（例如 AI 分组在 WeTab 里新建「AI / icon-ai」）。
  网址按归一化后去重，已经在目标端存在的会自动跳过。

文件怎么来：
  iTab（Chrome） 设置 → 备份与恢复 → 导出本地数据     → iTab备份-*.itabdata
  WeTab（Edge）  设置 → 备份数据 → 导出备份数据        → wetab-*.data
`;

function printMapping(stats, side, title) {
  const rows = stats.mapping.filter((m) => m.side === side);
  if (!rows.length) return;
  console.log(title);
  const width = Math.max(...rows.map((r) => Array.from(r.from).length), 4);
  for (const r of rows) {
    const pad = ' '.repeat(Math.max(0, width - Array.from(r.from).length));
    console.log(`  ${r.from}${pad}  →  ${r.how}「${r.to}」  +${r.count}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  const inDirs = [path.join(HERE, 'in'), HERE];

  let itabPath = opts.itab;
  if (!itabPath) for (const d of inDirs) itabPath ||= findLatest(d, (f) => /\.itabdata$/i.test(f));
  let wetabPath = opts.wetab;
  if (!wetabPath) {
    for (const d of inDirs) {
      wetabPath ||= findLatest(d, (f) => /\.data$/i.test(f) && !/^WeTab-导入/.test(f) && !/^hitab/i.test(f));
    }
  }

  console.log('='.repeat(64));
  console.log(' iTab ⇄ WeTab 图标互通转换器');
  console.log('='.repeat(64));
  console.log(itabPath ? `✔ iTab 导出：${itabPath}` : '✘ 没找到 iTab 导出文件（*.itabdata）');
  console.log(wetabPath ? `✔ WeTab 导出：${wetabPath}` : '✘ 没找到 WeTab 导出文件（*.data）');

  const wantWetabOut = opts.oneWay !== 'wetab';
  const wantItabOut = opts.oneWay !== 'itab';
  if (!itabPath && !wetabPath) {
    throw new Error(
      '没找到任何导出文件。\n\n' +
      '  请先把两边的导出文件放进这个文件夹：\n' +
      `    ${path.join(HERE, 'in')}\n\n` +
      '    · iTab备份-*.itabdata   ← Chrome/iTab：设置 → 备份与恢复 → 导出本地数据\n' +
      '    · wetab-*.data          ← Edge/WeTab：设置 → 备份数据 → 导出备份数据\n\n' +
      '  也可以把两个文件直接拖到「一键转换.bat」上，或者用 --itab / --wetab 指定路径。'
    );
  }
  if (wantWetabOut && !itabPath) throw new Error('要生成 WeTab 的导入文件，需要 iTab 的导出文件（*.itabdata）。');
  if (wantItabOut && !wetabPath) throw new Error('要生成 iTab 的导入文件，需要 WeTab 的导出文件（*.data）。');

  const itabExport = itabPath ? readJson(itabPath, ' iTab ') : null;
  const wetabExport = wetabPath ? readJson(wetabPath, ' WeTab ') : null;

  if (itabExport && !Array.isArray(itabExport.navConfig)) {
    throw new Error('这个 .itabdata 里没有 navConfig，不像是 iTab 的导出文件（是不是选成了别的备份？）');
  }
  if (wetabExport && !wetabExport.data) {
    throw new Error('这个 .data 里没有 data 字段，不像是 WeTab 的导出文件（是不是选成了别的备份？）');
  }

  const beforeItabGroups = itabExport?.navConfig?.length ?? 0;
  const beforeItabItems = (itabExport?.navConfig ?? []).reduce((n, g) => n + (g.children?.length || 0), 0);
  const beforeWetabCats = wetabExport?.data?.['store-icon']?.icons?.length ?? 0;
  const beforeWetabItems = (wetabExport?.data?.['store-icon']?.icons ?? []).reduce((n, c) => n + (c.children?.length || 0), 0);
  console.log('-'.repeat(64));
  console.log(`iTab 现有：${beforeItabGroups} 个分组 / ${beforeItabItems} 个图标`);
  console.log(`WeTab 现有：${beforeWetabCats} 个分区 / ${beforeWetabItems} 个图标`);

  const stats = newStats();
  const results = {};

  if (wantWetabOut) {
    const r = buildWetabFile(wetabExport, itabExport, opts, stats);
    const errs = validateWetabFile(r.file);
    if (errs.length) throw new Error('生成的 WeTab 文件校验不通过：\n  - ' + errs.slice(0, 10).join('\n  - '));
    results.wetab = r;
  }
  if (wantItabOut) {
    const r = buildItabFile(itabExport, wetabExport, opts, stats);
    const errs = validateItabFile(r.file);
    if (errs.length) throw new Error('生成的 iTab 文件校验不通过：\n  - ' + errs.slice(0, 10).join('\n  - '));
    results.itab = r;
  }

  console.log('-'.repeat(64));
  if (results.wetab) printMapping(stats, 'wetab', 'iTab → WeTab 的合并方式：');
  if (results.itab) printMapping(stats, 'itab', 'WeTab → iTab 的合并方式：');
  console.log('-'.repeat(64));
  if (results.wetab) {
    console.log(`iTab → WeTab：并入 ${stats.addedToWetab} 个图标（新建分区 ${results.wetab.created} 个，并入现有 ${results.wetab.merged} 个）`);
  }
  if (results.itab) {
    console.log(`WeTab → iTab：并入 ${stats.addedToItab} 个图标（新建分组 ${results.itab.created} 个，并入现有 ${results.itab.merged} 个）`);
  }
  console.log(
    `重复跳过 ${stats.duplicates} 条；跳过 iTab 小部件 ${stats.skippedComponents} 个、WeTab 小组件 ${stats.skippedWidgets} 个`
  );
  if (stats.skippedPresets || stats.skippedSystemLinks) {
    console.log(
      `另外跳过 WeTab 自带的推荐站点 ${stats.skippedPresets} 个、系统快捷入口 ${stats.skippedSystemLinks} 个（不是你自己的网址）`
    );
  }

  if (opts.check) {
    console.log('-'.repeat(64));
    console.log('（--check 模式，没有写文件）');
    return;
  }
  if (!results.wetab && !results.itab) throw new Error('什么都没生成。');

  fs.mkdirSync(opts.out, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const written = [];

  if (results.wetab) {
    const p = path.join(opts.out, `WeTab-导入-${stamp}.data`);
    fs.writeFileSync(p, JSON.stringify(results.wetab.file), 'utf8');
    written.push({ kind: 'wetab', path: p, size: fs.statSync(p).size });
  }
  if (results.itab) {
    const p = path.join(opts.out, `iTab-导入-${stamp}.itabdata`);
    fs.writeFileSync(p, JSON.stringify(results.itab.file), 'utf8');
    written.push({ kind: 'itab', path: p, size: fs.statSync(p).size });
  }

  const reportLines = [
    `iTab ⇄ WeTab 同步报告  ${new Date().toLocaleString('zh-CN')}`,
    '',
    `iTab 导出：${itabPath || '（未使用）'}`,
    `WeTab 导出：${wetabPath || '（未使用）'}`,
    '',
    `模式：${opts.append ? '整块追加（--append）' : '语义合并（按主题并入现有分区）'}`,
    '',
    `iTab → WeTab：并入 ${stats.addedToWetab} 个图标 / 新建分区 ${results.wetab?.created ?? 0} 个 / 并入现有 ${results.wetab?.merged ?? 0} 个`,
    `WeTab → iTab：并入 ${stats.addedToItab} 个图标 / 新建分组 ${results.itab?.created ?? 0} 个 / 并入现有 ${results.itab?.merged ?? 0} 个`,
    `重复跳过 ${stats.duplicates} 条`,
    `跳过小部件：iTab ${stats.skippedComponents} 个、WeTab ${stats.skippedWidgets} 个（两边格式不同，无法互转）`,
    `跳过 WeTab 自带推荐站点 ${stats.skippedPresets} 个、系统快捷入口 ${stats.skippedSystemLinks} 个`,
    '',
    '合并明细：',
    ...stats.mapping.map((m) => `  [→${m.side === 'wetab' ? 'WeTab' : 'iTab'}] ${m.from} → ${m.how}「${m.to}」 +${m.count}`),
    '',
    '生成的文件：',
    ...written.map((w) => `  ${w.path}  (${(w.size / 1024).toFixed(1)} KB)`),
  ];
  const reportPath = path.join(opts.out, `转换报告-${stamp}.txt`);
  fs.writeFileSync(reportPath, reportLines.join('\r\n'), 'utf8');

  console.log('-'.repeat(64));
  console.log('生成好了：');
  for (const w of written) {
    console.log(`  ${w.kind === 'wetab' ? '[Edge] WeTab 导入' : '[Chrome] iTab 导入'}  ${w.path}  (${(w.size / 1024).toFixed(1)} KB)`);
  }
  console.log(`  报告：${reportPath}`);
  console.log('');
  console.log('下一步：');
  if (written.some((w) => w.kind === 'wetab')) {
    console.log('  1) Edge → 打开新标签页 → WeTab 设置 → 备份数据 → 导入备份数据 → 选 out\\WeTab-导入-*.data');
    console.log('     如果弹出「合并/覆盖」提示，选「合并」即可（文件里已经包含你现有的全部数据）。');
  }
  if (written.some((w) => w.kind === 'itab')) {
    console.log('  2) Chrome → 打开新标签页 → iTab 设置 → 备份与恢复 → 导入备份数据 → 选 out\\iTab-导入-*.itabdata');
  }
  console.log('');
  console.log('提示：以后想再同步一次，把两边重新导出的文件放进 in 目录、再跑一次就行（按网址去重，不会重复添加）。');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error('');
    console.error('出错了：' + e.message);
    process.exitCode = 1;
  }
}

export {
  urlKey, hexToRgba, rgbaToHex, itabId, wetabId, clampText, cleanImageUrl,
  topicOfName, topicOfItabGroup, topicOfWetabCategory,
  itabItemToWetabSite, itabGroupToWetabItems,
  wetabSiteToItabItem, wetabCategoryToItabItems,
  buildWetabFile, buildItabFile,
  validateWetabFile, validateItabFile,
  newStats, main,
};
