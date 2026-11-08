# iTab ⇄ WeTab 互转

Chrome 新标签页用 iTab，Edge 用 WeTab，收藏各存各的。两个扩展都支持本地导出和导入，这个工具读那两份导出文件，转成对方认识的格式，再合并回去。不读写扩展的数据库，也不模拟点界面。

Convert bookmarks between iTab (Chrome) and WeTab (Edge) through their own export files. No extension database access.

## 下载

到 [Releases](https://github.com/StanElka/itab-wetab-sync/releases) 下载：

- `convert.html`：网页版，双击就能用，不用装 Node。
- `itab-wetab-sync-1.1.0.zip`：源码，包含命令行版。

## 网页版用法

1. 两边各导出一份。

   Chrome / iTab：新标签页 → 设置 → 备份与恢复 → 导出本地数据，得到 `iTab备份-*.itabdata`

   Edge / WeTab：新标签页 → 设置 → 备份数据 → 导出备份数据，得到 `wetab-*.data`

2. 双击 `convert.html`，把两个文件拖进对应的框。拖错框没关系，会按文件内容放到正确的位置。

3. 点「转换」，下载生成的两个文件。

4. 分别导入。

   Chrome / iTab：备份与恢复 → 导入备份数据

   Edge / WeTab：备份数据 → 导入备份数据。弹出「合并 / 覆盖」时选合并，生成的文件已经包含你现有的全部数据，合并就是取并集。

文件不上传，转换在浏览器里完成，断网也能用。

## 命令行版

需要 Node 18 或更高。

把两个导出文件放进 `in/`，双击 `一键转换.bat`，或者在该目录执行 `node merge.mjs`。也可以把两个文件一起拖到 bat 上。

```
node merge.mjs                     自动在 in/ 里找最新的一对导出文件
node merge.mjs --check             只统计，不写文件
node merge.mjs --itab <文件> --wetab <文件>
node merge.mjs --one-way itab|wetab
node merge.mjs --append            整块追加成新分区，不并进现有分区
node merge.mjs --tag "（同步）"     --append 时的分区名后缀
node merge.mjs --no-tag            --append 时不加后缀
node merge.mjs --out <目录>         输出目录，默认 out/
node merge.mjs --help
```

生成的文件在 `out/`：`WeTab-导入-*.data`、`iTab-导入-*.itabdata`，以及一份记录了每条去向的 `转换报告-*.txt`。

## 合并规则

不会把 iTab 的整个分组原样倒成一个新分区，那样每同步一次就多一批「办公（iTab）」。

实际做法是先猜分组属于什么主题：看名字里的关键词，看不出来再看分组图标；然后到对方那边找同主题的现有分区，找到就并进去，找不到才新建（新建时用对应的名字和图标）。

本机跑出来的对应关系：主页→主页，办公→工具，编程→程序，摸鱼→娱乐，AI→科技（没有对应分区时新建）。数字是 101 条并入 5 个现有分区，新建 1 个。

有两类内容不搬：WeTab 装好自带的推荐站点（`origin` 以 `622af28e` 开头的那些），以及 `chrome://bookmarks/` 这类系统入口。

小部件两边格式不同，iTab 的天气日历和 WeTab 的小组件都跳过，会在结果里计数。

想要旧的整块追加行为，加 `--append`。

## 它不会动你别的数据

生成的文件以你自己的导出为底稿，只替换图标那一块，待办、便签、壁纸、搜索设置原样带回去。

这一步是必须的：WeTab 导入时，文件里缺哪个数据块，它就把本地那块重置成默认值，所以不能只塞一个图标块进去。

其余几条：

- 只增不删，脚本不会删掉现有图标或分组
- 网址去掉协议、`www.`、末尾斜杠和 `utm_*` 一类参数后再判重
- 导入前建议先手动导出一次备份

生成的文件里有你的网址，别随手发给别人。

## 常见问题

**以后又加了新网址怎么同步？**
重新导出两边，网页版再拖一次，或者丢进 `in/` 跑一次命令行。已存在的会跳过，只补新增的。

**反复导入会翻倍吗？**
不会，按归一化后的网址判重。

**导入后 WeTab 没变化？**
确认用的是最新生成的文件，然后刷新一下新标签页。

**只想要一个方向？**
`node merge.mjs --one-way itab` 只生成给 WeTab 的，`--one-way wetab` 反过来。

**会上传数据吗？**
不会。网页版在浏览器本地处理，命令行版是纯本地脚本，都不联网。

## 开发

- `merge.mjs`：核心逻辑和命令行，零依赖。
- `web/template.html`：网页版页面模板。
- `build-web.mjs`：把 `merge.mjs` 标记的核心段注入模板，生成 `convert.html`。
- `selftest.mjs`：49 项断言，`node selftest.mjs` 运行。

改了 `merge.mjs` 的核心段，要重新生成网页版：

```
node build-web.mjs
```

网页版另有页面内自检，打开 `convert.html#selftest` 会跑 10 项。

CI 在 Node 18/20/22 上跑 `selftest.mjs`。

两边导出格式差得比较远：

- iTab：`{baseConfig, navConfig: [{id, name, icon, children}]}`
- WeTab：`{version, branch, timestamp, platform, data: {"store-icon": {icons, dockIdList, ...}, "store-wallpaper": ..., ...}}`

实现时踩过的几处，写在这里省得后面的人再查：

1. WeTab 导入走 `useRestore(payload, "import-import")`，会遍历本地 store，payload 里没有的直接 `reset()`。所以必须以完整导出为底稿，只替换 `data["store-icon"]`。
2. 正常导入流程多半会走合并弹窗（`checkRecordForMerge` 发现时间戳不同，转 `import-merge`），对同 id 的分区是并集合并，比直接覆盖安全，工具按这条路设计。
3. iTab 的 `navConfig` 是整组替换，导入时直接覆盖 store，需要在原有分组基础上拼好再交。
4. WeTab 的 `getQiniuImage` 对 `.svg` 原样返回，对其它 URL 只追加七牛参数，所以 iTab 的 SVG 地址可以直接当 `bgImage`。
5. `chrome.storage.local` 的 LevelDB 里同一个逻辑键存着很多历史版本（实测 `navConfig` 有 15 个变体），没法可靠判断哪条是当前值，这也是不直接读数据库的原因。

## License

MIT，见 [LICENSE](LICENSE)。
