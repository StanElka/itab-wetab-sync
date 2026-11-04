# iTab ⇄ WeTab 数据互通工具

> Merge your bookmarks between **iTab** (Chrome new tab) and **WeTab** (Edge new tab) — no copy-pasting URLs, no poking at extension databases. Both extensions have local JSON export/import, so this script just translates one format into the other, and merges by **topic** instead of dumping whole groups.
>
> Zero dependencies. Node ≥18. Windows batch file included. MIT.

一句话：**不用一条条复制，两边各自「导出 → 跑一下脚本 → 导入」就行。**

```
Chrome/iTab  ──导出──►  iTab备份-xxx.itabdata  ┐
                                              ├─►  merge.mjs  ─┬─► WeTab-导入-xxx.data    ──导入──► Edge/WeTab
Edge/WeTab   ──导出──►  wetab-xxx.data        ┘                 └─► iTab-导入-xxx.itabdata ──导入──► Chrome/iTab
```

两个方向可以**同时**做，也可以只做一个方向。
按网址去重，**跑一百次也不会产生重复图标**，所以以后可以当日常同步用。

---

## 一、它做了什么事

| | iTab（Chrome） | WeTab（Edge） |
|---|---|---|
| 数据存在哪 | 扩展自己的本地存储（LevelDB 里的 JSON） | IndexedDB 里的二进制结构（没法直接改） |
| 官方导出 | 设置 → 备份与恢复 → **导出本地数据** → `iTab备份-*.itabdata`（就是 JSON） | 设置 → 备份数据 → **导出备份数据** → `wetab-*.data`（也是 JSON） |
| 官方导入 | 设置 → 备份与恢复 → **导入备份数据** | 设置 → 备份数据 → **导入备份数据** |

既然两边都吃 JSON，那就**不碰数据库、不模拟点击**，只做文件转换——最稳、随时可撤销。

转换时的对应关系：

| iTab | WeTab |
|---|---|
| 分组（Group） | 分区 / category（`icon-*` 那排） |
| 图标 `type:"icon"`（有图） | 站点 `bgType:"image"` + `bgImage` |
| 文字图标 `type:"text"` | 站点 `bgType:"color"` + `bgText`（取前 2 字）+ `bgColor` |
| 文件夹 `type:"folder"` | 文件夹 `folder-icon` |
| 小部件 `type:"component"`（天气/日历/热搜…） | ✘ 无法转换，自动跳过并计数 |
| — | WeTab 小组件 `type:"widget"` ✘ 无法转换，自动跳过 |

> 之所以能这样对应：两边的图标都是「一张背景图」或「纯色底 + 两个字」两种画法，
> 而且 WeTab 渲染图片时用的是 `background-image: url(...)`，**外链 SVG/PNG 都能正常显示**，
> 所以 iTab 的图标地址（`files.itab.link/*.svg`）搬过去一样能看。

### 按「主题」合并，不是整块倒过去

两边给分组起的名字不一样（iTab 叫「办公」，WeTab 叫「工具」），直接整块搬会变成
「办公（iTab）」这种平行分区，越同步越乱。所以脚本中间加了一层「主题」判断：

1. 先按**分组名字里的关键词**猜主题（「AI / 人工智能 / 大模型」→ ai，「购物 / 商城」→ shop …）；
2. 名字看不出来，再看**分组图标**（iTab 的 `code`、WeTab 的 `icon-chengxu` …）；
3. 拿主题去目标端找**同主题的现有分区**，找得到就**并进去**，找不到才新建一个，
   新建时用正经名字 + 正经图标（AI → `icon-ai`、阅读 → `read`）。

举个本机的真实例子：

| 源分组 | 主题 | 在目标端落到哪 |
|---|---|---|
| iTab「主页」`home` | home | WeTab「主页」，14 个网址补进去 |
| iTab「办公」`office` | tool | WeTab「工具」（原来是空的） |
| iTab「编程」`code` | code | WeTab「程序」 |
| iTab「AI」`ApiApp` | ai | WeTab「科技」（原来空的，正好接住 AI 站点） |
| iTab「摸鱼」`entertainment` | entertainment | WeTab「娱乐」 |

另外两类东西**不会搬**：WeTab 随安装附带的推荐站点（一装就有的 Amazon、当当那一批），
以及 `chrome://bookmarks/` 这类系统快捷入口——搬过去只是多一排没用的图标。

想退回老的「整块搬 + 加（iTab）后缀」行为，就加 `--append`。

## 二、安全性（重要，先读这段）

1. **不会有数据被清空。**
   - 生成的 WeTab 文件以**你自己的 WeTab 导出**为底稿，除了「图标」那一块，待办、便签、壁纸、搜索设置等等**一字不改**原样带回去。
     （WeTab 的导入逻辑里有个坑：导入文件里缺哪个数据块，它就把本地那块重置成默认值。所以必须做底稿，不能只塞一个图标块。）
   - 生成的 iTab 文件同理，以你自己的 iTab 导出为底稿，只往分组里补图标、必要时新建分组。
2. **只增不删。** 脚本不会删除任何现有图标/分组，也不会覆盖同名数据；合并只是往现有分区里追加。
3. **重复网址自动跳过**（`www.`、`http/https`、末尾斜杠、`utm_*` 等跟踪参数都会被归一化后比较）。
4. **导入前请先手动导出一次做备份**（两边的设置里都有「导出」，点一下的事）。

## 三、怎么用（3 步）

### 第 1 步：两边各导出一次

- **Chrome**：新标签页 → 右下角/右上角设置 → **备份与恢复** → **导出本地数据** → 得到一个 `iTab备份-2026-11-3 17xxx.itabdata`
- **Edge**：新标签页 → 设置 → **备份数据** → **导出备份数据** → 得到一个 `wetab-2026-11-3.data`

> 找不到的话就在设置里找带「备份」两个字的页签，两边都一定有——这是它们自带的换机迁移功能。

### 第 2 步：把两个文件丢进 `in` 文件夹，双击 `一键转换.bat`

```
itab-wetab-sync\
├─ 一键转换.bat        ← 双击它
├─ merge.mjs           ← 转换脚本
├─ selftest.mjs        ← 自检（可选）
├─ in\                 ← 把两个导出文件放这里
│   ├─ iTab备份-xxx.itabdata
│   └─ wetab-xxx.data
└─ out\                ← 生成的文件在这里
```

也可以把两个文件**直接拖到 `一键转换.bat` 上**，一样能跑。
想先看看会同步多少条、不写文件：`node merge.mjs --check`

### 第 3 步：把 `out` 里生成的文件分别导入

| 生成的文件 | 导入到哪 |
|---|---|
| `WeTab-导入-*.data` | Edge → WeTab 设置 → 备份数据 → **导入备份数据** |
| `iTab-导入-*.itabdata` | Chrome → iTab 设置 → 备份与恢复 → **导入备份数据** |

**WeTab 导入时会弹一个「合并 / 覆盖」的框**（因为它发现云端时间戳变了）：
选 **「合并」** 即可 —— 文件里已经包含你当前的全部数据，选合并最保险。
导入完 WeTab 会提示可以「撤销」，点一下就能退回导入前，所以不用怕出错。

## 四、注意事项

- **默认是按主题并进现有分区**，所以不会凭空多出「（iTab）」分区；只有目标端确实没有同类分区时才新建。
  想一眼看出哪些是搬来的，就加 `--append`（整块追加 + 「（iTab）」/「（WeTab）」后缀），或 `--tag "（同步）"` 自定义标记。
- **小部件转不了**：iTab 的天气/日历/热搜/待办，WeTab 的小组件，两边模型完全不同，脚本会跳过并告诉你跳了几个。
  少数能对上的（比如「天气」）建议在目标侧手动加一个，反正就点两下。
- **图标风格会有差异**：分区图标（那排 `icon-*`）只有固定 29 个可选，脚本会按分组名字猜（设计→icon-sheji、AI→icon-ai…），猜不准就在 WeTab 里手动换一个。
- **iTab 自带工具**（书签管理、壁纸、PDF 转换这些没有网址的内置图标）不会搬过去——它们在 WeTab 里没有对应物。
- **只搬「图标/书签」，不搬账号数据**。两边的会员、云同步、壁纸这些各自独立。
- 生成的文件里是你的个人浏览收藏（含网址），**别随手发给别人**。

## 五、常见问题

**Q：以后 Chrome 里又加了几个网址，怎么再同步？**
重新导出两边 → 丢进 `in` → 双击 bat → 导入。已存在的网址会被跳过，只会补新增的。

**Q：上一次导入过，这次又导入会不会翻倍？**
不会。判重是按网址归一化之后的，`https://www.bilibili.com/` 和 `http://bilibili.com` 算同一条。

**Q：导入后 WeTab 图标没变？**
WeTab 的导入有「合并」流程，确认弹窗里选了合并、并且导入完成提示出现后，**刷新一下新标签页**。
若还是没变，检查导入的是不是 `out` 里最新那个 `.data` 文件（文件名带日期时间）。

**Q：能不能只同步一个方向？**
可以：
```
node merge.mjs --one-way itab    :: 只生成给 WeTab 的导入文件（iTab → WeTab）
node merge.mjs --one-way wetab   :: 只生成给 iTab 的导入文件（WeTab → iTab）
```

**Q：脚本安全吗？会不会上传我的数据？**
纯本地 Node 脚本，零第三方依赖，不联网、不写系统目录，只读写 `in` / `out` 两个文件夹。

## 六、自检（可选）

```
node selftest.mjs
```

会用仿真 WeTab 备份 + 仿真 iTab 数据（本机有真实导出时再加跑一遍真实数据冒烟）跑通两个方向，验证 49 项：字段合法性、原有数据零改动、主题合并落点、网址去重、文件夹/文字图标转换、幂等（反复运行不重复）。
换 Node 版本或改过脚本后跑一下比较安心。

## 七、命令行参数

```
node merge.mjs                     自动在 ./in 里找两边的导出文件
node merge.mjs --check             只统计，不写文件
node merge.mjs --itab <文件> --wetab <文件>
node merge.mjs --one-way itab|wetab
node merge.mjs --append            旧行为：整块追加成新分区，不并进现有分区
node merge.mjs --tag "（同步）"     --append 时的新分区名后缀（默认「（iTab）」/「（WeTab）」）
node merge.mjs --no-tag            --append 时不加后缀
node merge.mjs --out <目录>         输出目录（默认 ./out）
node merge.mjs --help
```

---

*原理备注：WeTab 的导入走 `importData → useRestore(payload, "import-import")`，其中对「本地有记录、但 payload 里缺失」的每个 store 会 `store.reset()`；因此本工具始终以用户自己的导出为底稿，只替换 `data["store-icon"]`。iTab 的导入走 `JSON.parse → P(backup)`，`navConfig` 是整组替换，因此在原有分组后追加即可。*

## 八、背景（为什么写这个）

Chrome 上一直用 iTab，Edge 上一直用 WeTab，两边的收藏是两套互不相通的数据。想换边、或者两边都想用同一份收藏时，
官方唯一的办法就是「导出 → 手动一条条搬」，或者干脆重建。

两个扩展都提供**本地 JSON 导出/导入**（换机迁移用的），只是结构完全不同：

- iTab：`{baseConfig, navConfig: [{id, name, icon, children: [站点 / 文件夹 / 小部件]}]}`
- WeTab：`{version, branch, timestamp, platform, data: {"store-icon": {icons: [分区], dockIdList, …}, "store-wallpaper": …, …}}`

于是就有了这个转换器：**只做文件转换**，不碰 LevelDB / IndexedDB，不模拟点击，随时可撤销。

几个实现上的坑，供后来者少走弯路：

1. **WeTab 导入会重置缺失的数据块**：`useRestore(payload, "import-import")` 会遍历本地 store，payload 里没有的就 `reset()`。
   所以不能只给一个「图标」块，必须以用户自己的完整导出为底稿，只替换 `data["store-icon"]`。
2. **WeTab 点「导入」时多半会走合并弹窗**（`checkRecordForMerge` 发现时间戳不同 → `import-merge`），
   它对同 id 的分区是**并集**合并，比 `import-import` 安全 —— 所以工具是按「合并」这条路设计的。
3. **iTab 的 `navConfig` 是整组替换**：导入时 `P(backup)` 直接用备份里的 `navConfig` 覆盖 store，所以要在原有分组基础上自己拼好。
4. **WeTab 的图标渲染**走 `background-image: url(getQiniuImage(...))`；`getQiniuImage` 对 `.svg` 原样返回、对其它 URL 只追加七牛参数
   —— 所以 iTab 的 `files.itab.link/*.svg` 可以直接当 `bgImage` 用，不会坏。
5. `chrome.storage.local` 的 LevelDB 里，同一个逻辑键存着大量历史版本（实测 `navConfig` 有 15 个变体），
   **无法可靠判断哪条才是当前值** —— 这也是为什么本项目坚持走官方导出，而不是直接读数据库。

## 九、License

MIT，见 [LICENSE](LICENSE)。欢迎 issue / PR，尤其欢迎补充分组名关键词（现在的中文主题词典偏个人使用习惯）。
