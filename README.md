# iTab ⇄ WeTab

Chrome 的新标签页用 iTab，Edge 用 WeTab，两边的收藏各存各的。想共用只能一条条复制网址，或者干脆重来。

两个扩展都带本地导出和导入（本来是给换机器用的）。这个工具就是读这两份导出文件，转成对方的格式，再合并回去。不碰扩展数据库，也不模拟点击。

Merge bookmarks between iTab (Chrome new tab) and WeTab (Edge new tab). Both extensions can export and import local JSON, so the work is a format conversion. Node 18+, no dependencies.

## 准备

- Node.js 18 或更高（`node -v` 有输出就行）
- 两边各导出一份

Chrome：新标签页 → 设置 → 备份与恢复 → 导出本地数据，得到 `iTab备份-*.itabdata`

Edge：新标签页 → 设置 → 备份数据 → 导出备份数据，得到 `wetab-*.data`

## 转换

把两个文件放进 `in/`：

```
itab-wetab-sync/
├─ 一键转换.bat      Windows 双击这个
├─ convert.bat       同上，英文文件名
├─ merge.mjs
├─ selftest.mjs
├─ in/               两个导出文件放这里
└─ out/              生成的文件
```

双击 `一键转换.bat`，或者命令行跑 `node merge.mjs`。也可以把两个文件一起拖到 bat 上。

想先看会同步多少条、不写文件，加 `--check`。

`out/` 里会多出三个文件：

| 文件 | 用途 |
|---|---|
| `WeTab-导入-*.data` | Edge → WeTab → 备份数据 → 导入备份数据 |
| `iTab-导入-*.itabdata` | Chrome → iTab → 备份与恢复 → 导入备份数据 |
| `转换报告-*.txt` | 这次合并的明细，每一条去了哪个分区 |

WeTab 导入时会弹「合并 / 覆盖」，选合并。生成的文件已经包含你当前的全部数据，合并的结果就是并集。

## 字段对应

| iTab | WeTab |
|---|---|
| 分组 | 分区 |
| 图标 `type:"icon"` | 站点 `bgType:"image"` + `bgImage` |
| 文字图标 `type:"text"` | 站点 `bgType:"color"` + `bgText` + `bgColor` |
| 文件夹 `type:"folder"` | `folder-icon` |
| 小部件 `type:"component"` | 转不了，跳过并计数 |
| — | 小组件 `type:"widget"` 转不了，跳过并计数 |

两边图标都是「一张背景图」或「纯色底加两个字」，所以能直接对应。WeTab 渲染用的是 `background-image: url(...)`，外链 SVG 也能显示，iTab 那些 `files.itab.link/*.svg` 搬过去正常。

### 分区怎么对齐

两边的分组名字不一样，iTab 叫「办公」，WeTab 叫「工具」。整块搬会多出一堆「办公（iTab）」这样的平行分区，所以中间加了一层主题判断：

先看分组名字里的关键词，看不出来再看分组图标，然后去目标端找同主题的分区。找到就并进去，找不到才新建，新建时用正经名字和图标。

本机实际跑出来的样子：主页并进主页，办公并进工具，编程并进程序，AI 并进科技，摸鱼并进娱乐。

有两类不搬：WeTab 装好就带的推荐站点（origin 以 `622af28e` 开头），和 `chrome://bookmarks/` 这类系统入口。

想回到整块追加的老行为，加 `--append`。

## 数据安全

生成的文件以你自己的导出为底稿，只换掉图标那部分，待办、便签、壁纸、搜索设置原样带回去。

这不是多此一举。WeTab 的导入逻辑里，文件里缺哪个数据块，它就把本地那块重置成默认值。所以不能只塞一个图标块。

其它几条：

- 只增不删，脚本不会删掉现有图标或分组
- 网址先归一化再比较，`www.`、协议、末尾斜杠、`utm_*` 这些参数不影响判重
- 导入前建议先手动导出一次备份

生成的文件里有你的网址，别随手发给别人。

## 常见问题

**以后再加了新网址怎么同步？**
重新导出两边，丢进 `in/`，双击 bat，导入。已存在的会跳过，只补新增的。

**反复导入会翻倍吗？**
不会，按归一化后的网址判重。

**导入完 WeTab 没变化？**
确认用的是 `out/` 里最新的文件，导入后刷新一下新标签页。

**只同步一个方向？**
`node merge.mjs --one-way itab` 只生成给 WeTab 的，`--one-way wetab` 反过来。

**会上传数据吗？**
不会，纯本地脚本，不联网。

## 命令行

```
node merge.mjs                     自动在 ./in 里找最新的一对导出文件
node merge.mjs --check             只统计，不写文件
node merge.mjs --itab <文件> --wetab <文件>
node merge.mjs --one-way itab|wetab
node merge.mjs --append            整块追加成新分区，不并进现有分区
node merge.mjs --tag "（同步）"     --append 时的分区名后缀
node merge.mjs --no-tag            --append 时不加后缀
node merge.mjs --out <目录>         输出目录，默认 ./out
node merge.mjs --help
```

## 自检

```
node selftest.mjs
```

用仿真数据跑两个方向，验证 49 项：结构校验、主题合并的落点、网址去重、文件夹和文字图标的转换、重复运行不新增。本机有真实 iTab 导出时会再跑一遍做冒烟。

推代码前会由 GitHub Actions 在 Node 18/20/22 上跑一次。

## 为什么写这个

Chrome 上一直用 iTab，Edge 上一直用 WeTab，两边的收藏是两套互不相通的数据。官方只有导出导入，没有互通的办法。

两个扩展导出格式差得挺远：

- iTab：`{baseConfig, navConfig: [{id, name, icon, children}]}`
- WeTab：`{version, branch, timestamp, platform, data: {"store-icon": {icons, dockIdList, ...}, "store-wallpaper": ..., ...}}`

实现时踩到几件事，记下来省得后面的人再查：

1. WeTab 导入走 `useRestore(payload, "import-import")`，它会遍历本地 store，payload 里没有的直接 `reset()`。所以必须以完整导出为底稿，只替换 `data["store-icon"]`。
2. 正常的导入流程多半会走合并弹窗（`checkRecordForMerge` 发现时间戳不同，转 `import-merge`），对同 id 的分区是并集合并，比 `import-import` 安全，工具按这条路设计。
3. iTab 的 `navConfig` 是整组替换，导入时直接覆盖 store，所以要在原有分组基础上拼好再交。
4. WeTab 的 `getQiniuImage` 对 `.svg` 原样返回，对其它 URL 只追加七牛参数，所以 iTab 的 SVG 地址可以直接当 `bgImage`。
5. `chrome.storage.local` 的 LevelDB 里，同一个逻辑键存着很多历史版本（实测 `navConfig` 有 15 个变体），没法可靠判断哪条是当前值。这也是不做直接读数据库的原因。

## License

MIT，见 [LICENSE](LICENSE)。
