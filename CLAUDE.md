# html-video 项目工作区

> Open-source HTML→Video meta-layer。让本地 coding agent 跨多个渲染 engine（Hyperframes / Remotion / Motion Canvas / Revideo）一站式做 HTML 视频。
> 启动时间：2026-05-26（继 OD / HA / OD-pitch / OD-landing 之后的下一代 nexu-io 开源产品）

## 角色与边界

- **角色**：T9（端口段 **3071-3079**）—— 现有 T1-T8 已分配
- **职责**：html-video 项目的产品定位 / 架构 / engine 适配器 spec / 模板生态 / agent skill 设计 / 文档 / 公开 launch 物料
- **不做**：
  - 跨项目协调（T1 主控的活）
  - OD 主线开发（T5 `open-design` 工作树）
  - 增长策略 / OKR（T2 `opendesign-growth`）

## 产品定位（决策时间线）

- **2026-05-26 启动思路**：Joey 最初以为 Hyperframes 是闭源 SaaS，想做 "HTML 视频开源整合工具"。调研发现 Hyperframes 已经是 Apache-2.0 开源 + 21K★ + agent-native，跟 Joey 设想的产品 1:1 重合。
- **2026-05-26 定位拍板**：放弃"做 HF 杀手"的正面竞争路线，改走 **Meta-aggregator** —— 把 HF / Remotion / Motion Canvas / Revideo 都包成可选 backend，agent 选 engine + 模板 + 一键出片。差异化明确，跟 HF 不正面撞。

### 关键差异化 vs Hyperframes

| 维度 | Hyperframes | html-video |
|---|---|---|
| 渲染引擎 | 单一（GSAP+Puppeteer） | 多引擎 pluggable |
| Authoring 范式 | 单一（HTML+CSS+GSAP） | 跟随 backend（HTML/React/TS-generator 都行） |
| Agent 能力 | 自家 skill | 跨引擎 agent 决策 + skill 注入 |
| 模板生态 | 自家曲库 | 跨生态 curated + 社区贡献 |

## 目录结构

```
html-video/
├── README.md                  公开门面（对外，已立）
├── CLAUDE.md                  本文件，内部 working notes
├── LICENSE                    Apache-2.0
├── .gitignore                 通用
├── notes/                     迭代笔记 / RFC 草稿 / 决策记录
├── research/                  竞品调研 / engine spec 草案 / API 探索
└── assets/                    素材（截图 / 草图 / launch 物料）
```

代码骨架（adapter spec、CLI、studio 等）等架构定型后另起 `core/` `adapters/` `cli/` `studio/` 等目录。

## 当前状态（2026-05-28 v0.8 content-graph + multi-frame）

v0.7 之前的进展见 git log。本节记 v0.8 落地的事 + 还没接的事。

- ✅ `@html-video/content-graph` 新 package：ContentGraph schema（entity/data/text 节点 + sequence/dependency/contrast 边）+ `validate` + `topoSort`（dependency 硬约束 / sequence 软排 / contrast 不参与排序）+ `totalDurationSec`
- ✅ core：`Project` 加 `contentGraphPath` + `frames[]`；`orchestrator` 加 `writeContentGraph` / `readContentGraph` / `writeFrameHtml`；`exportMp4` 多帧路径走 ffmpeg concat（缺 ffmpeg 时报友好错）
- ✅ studio agent：prompt 同时教单帧 fast path + 多帧（\`\`\`json#content-graph + \`\`\`html#&lt;nodeId&gt; 双块协议）；server 解析后自动调 writeContentGraph + writeFrameHtml；无 graph 时回落 v0.7
- ✅ studio UI：frames-strip 切帧 + graph viewer modal（JSON 只读 + 下载）；单帧 fast path 时整条隐藏
- ✅ 已 push `nexu-io/html-video` main（commit `149ace9`）
- ⏳ HF upstream 真实 render（v0.9?）：adapter-hyperframes 仍是 stub，单帧/多帧 export MP4 都是空文件
- ⏳ ffmpeg concat 真实跑通：依赖 ffmpeg 装好；adapter render 出真 MP4 之后才 end-to-end 有用
- ⏳ RFC-06 正式文档稿（落 `research/2026-05-28-spec-06-content-graph.md`）；目前规范散在 content-graph package README + smoke + agent prompt 三处
- ⏳ studio 的 graph viewer 现在只读，未来可加可视化编辑（拖节点 / 加边）

## 会话进度（2026-06-07）— Remotion 原生数据模板 + 按帧增强（Phase A+B 跑通，**git 待 Joey 定**）

> 起点：Joey 修正定位——**Remotion 是用户主动按帧挂的"动效增强插件"，hyperframes 是基座，AI 退到建议**（推翻 RFC-09 v0.1 的"AI 自动选引擎/引擎名隐形"）。本轮做 RFC-08 **Phase 2 原生 tsx 数据动画** 的第一刀：CLI 层跑通混流 MP4。在 `feat/remotion-adapter` 分支（HEAD 原 `633a3dd` = Phase 1 桥接）。

**做完的（全部端到端真实渲染 + 量像素验证，非 mock）：**
- ✅ 类型层（`packages/core/src/types/index.ts`）：`TemplateRef` 加 `mode?:'bridge'|'native'` + `nativeCompositionId?`；`FrameRecord` 加 `engine?`/`nativeTemplateId?`/`data?`；`TemplateMetadata` 加 `native?:{compositionId}`。
- ✅ 首个**原生 Remotion 模板** `templates/frame-data-rollup/`：`DataRollup.tsx`（柱子 `spring()` 生长 + 数字 `interpolate()` 0→目标滚动）+ `Root.tsx`（honor inputProps.width/height）+ `entry.ts` + yaml（`engine:remotion` / `native.compositionId:DataRollup` / provenance origin=none 原创）+ SKILL/example/package/preview.png。纯系统字体栈避黑屏。
- ✅ `adapter-remotion/src/render.ts`：抽 `renderComposition()` helper；加 `mode==='native'` 分支（bundle 模板自己 entry / select compositionId / inputProps={data,width,height}、不跑 neutralize）；`bundleCache` 单条 → `Map<entryPath,serveUrl>`（bridge+native 共存、原生模板一次 bundle 跨多帧复用）。
- ✅ `core/src/project.ts`：export loop 按帧解析引擎（`resolveFrameTemplateRef`）；`enhanceFrameNative(projectId,nodeId,nativeTemplateId)`（断言 kind=data、`normalizeRollupData` 归一 node.data、设三字段）+ `unenhanceFrame`（清三字段，htmlPath 不动=非破坏性）；`concatFramesWithFfmpeg` 加 `reencode` 参数。
- ✅ 文档纠正：RFC-09 升 v0.2（定位改"基座+主动增强+AI 建议"）；旧 notes `2026-06-06-remotion-user-experience-design.md` 顶部加作废声明指向 v0.2。

**Phase A 验收（单原生帧 vs 桥接对照，量像素）**：原生 native.mp4 非黑像素 **1.5%→8.8%→16.9%**（柱子在长）vs 桥接静态图 **22.6%×3 恒定**；同时刻 t=0.5 两者差 **56.7万像素**。铁证"原生数据动画 ≠ 桥接静态图"。6.2s 出 120 帧 1080p。
**Phase B 验收（真实 orchestrator 3 帧混流）**：intro(hyperframes 蓝)→ middle(`enhanceFrameNative`→原生 Remotion 数据柱)→ outro(hyperframes 酒红)，`exportMp4`→一条 **8.000s** MP4，全解码无错、单流、三段视觉各异。

**关键教训（新会话必读）：**
- **混流 concat 不能用 concat demuxer + 重编码**：hyperframes 与 Remotion 段的 timebase/PTS 不兼容，concat demuxer 会**错误累加时间戳→8s 片变 35s**（`-vsync cfr` 也救不了，因为坏 PTS 已被喂进来）。**正解 = concat FILTER**：每段独立 `-i` + `-filter_complex "[0:v][1:v]...concat=n=N:v=1[v]"` 重建时间轴 → 精确 8s。单引擎仍走 demuxer `-c copy`（快、无损）。判混流类输出**必须 ffprobe 量时长 + `ffmpeg -f null -` 全解码**，不能只看文件生成。
- **Remotion 能 bundle 模板自己的 `source/entry.ts`**（templates/ 下无独立 node_modules），webpack 能 resolve 到 workspace 根的 react/remotion——最大未知，已验证可行。原生模板做成 `templates/` 一等模板（不塞进 adapter 内部）这条路通。
- **本机仍无 timeout 命令**（macOS）；PIL 仍装不上（brew Python expat bug），量像素继续用 ImageMagick `magick ... -threshold -format '%[fx:100*mean]'`。

**待 Joey 定（git 写操作，未执行）**：① 本轮改动开 PR（按惯例对外可见/新模板走 PR review）还是直推；② 上一会话(6/6)遗留的 CLAUDE.md 39 行未提交记录怎么处理（CLAUDE.md 是追踪文件但属内部 notes，不宜混进代码 PR）。临时 driver 在 `~/Desktop/claude-code/scratch/hv-remotion-native/`（不进库）。

## 会话进度（2026-06-06）— 渲染 + studio 一连串修复，**4 个 PR 全部 merged 进 main**

> 任务起点："继续修字体跳闪"。顺着 Joey 的逐轮实测，从渲染引擎挖到 studio agent 交互/生成层，
> 修了 4 个 PR 全部合并。**全部端到端实调 Anthropic API 验证（非 mock）。** main 顶 = `1a83279`。

| PR | 修了什么 | merge commit |
|---|---|---|
| [#22](https://github.com/nexu-io/html-video/pull/22) | 字体跳闪（FOUT）+ 多 composition 完整播放 | `0029840` |
| [#23](https://github.com/nexu-io/html-video/pull/23) | 多帧改内容重生成整片 graph + 主题纠偏 + confirm 软校验 | `bf4b215`(merge `e340af1`) |
| [#24](https://github.com/nexu-io/html-video/pull/24) | 主题从开场原话贯穿到生成（"随机"不跑题） | `a9c5325` |
| [#25](https://github.com/nexu-io/html-video/pull/25) | 生成后迭代子状态机 + 每帧时长硬约束 + 自由发挥推进 | `1a83279` |

**改动文件**（都在 main）：`packages/adapter-hyperframes/src/render.ts`（字体冻结、时长 explicit）、
`packages/cli/src/studio-server.ts`（主题锁定、生成后迭代）、`packages/core/src/types/index.ts`+`project.ts`（durationMode）。

**#22 字体跳闪真根因（两轮才修对）**：① 第一版只加 `document.fonts.ready` 等待——不够，因为纯 CSS
`@keyframes` 动画在 `goto` 后**不等字体就自动跑**，等字体的 ~3s 连同 FOUT 一起被 playwright 录进开头，
单文件模板还不裁死区。② 正解：`addInitScript` 注入 `* {animation-play-state:paused}` 在文档解析前**冻结所有动画**
→ 等 stylesheet link + `fonts.load()` 每个 face + `fonts.ready` → 解冻并把冻结期当 leadInMs 裁掉。统一了单文件 + 多 composition 时序。
对 CSS/rAF/setTimeout 三类驱动都验证首帧字体正确（`fonts.check()=true`）。

**#25 生成后迭代（Joey 反复反馈"后面指令全失效"的核心）**：根因 = `detectPhase` L1793 `hadGenerationYet()=true`
把**生成后任何消息硬判成 iterate**，iterate 只做单帧 preview.html 重写 → 假"✓ updated"。
正解 = 卡片驱动子状态机：pin 帧→单帧编辑；明确说改风格/模板/时长/内容→直达对应卡；**其余一切（含模糊"改一下"/
"换个模板重新生成"）→ 默认弹 edit-menu 问清楚**。换风格走 restyle（复用现有 graph 文案、跳过重规划、仅按新风格逐帧重渲）。

### 关键教训（新会话必读）

- **字体跳闪只在导出 mp4 复现**（后端冷 chromium 录屏）；**studio iframe 实时预览有字体缓存，看不出**。验证载体只能是导出的 mp4，量早期帧（t≈0.1s）字体形态。本机 PIL 装不上（brew Python expat bug），量像素用 ImageMagick；颜色验证用 computed-style 而非截图（Playwright 截图在动画站超时）。
- **studio agent 这种"判用户意图"的逻辑，别用白名单正则判触发**——"换个模板重新生成一下"就因不在白名单掉进单帧重写黑洞。正确思路是**反转默认**：默认走交互/重生成，只有明确的少数情况（pin 帧）才单帧。判 render/交互类修复**必须端到端实跑**，不能信"tsc 过 + 逻辑看着对"。
- **`project.intent` 字段前端创建时不传**（只发 name），恢复开场主题靠 `history.find(role==='user')` 第一条。
- **per_frame 时长**：render.ts 探测动画长度会无条件 extend 覆盖用户设定（4s→29.7s）。修法 = `RenderConfig.durationMode='explicit'`（多帧 export 传），explicit 时不 extend，ffmpeg `tpad=stop_mode=clone` 补尾帧到精确时长；单帧快速预览仍 'auto' 照常 extend。
- **PR 合并流程坑（2026-06-06 踩过）**：PR #23 在我追加第二个 commit **之前**就被合并了（merge commit，非 squash，疑 Joey 手点或自动合），导致那个 commit 落空 → 只能 cherry-pick 到新分支另开 #24 补。教训：push 追加 commit 前先确认 PR 还 OPEN。Joey 偏好 **squash 合并**。

**会话尾已清理**：4 个 `fix/*` 分支（本地+远端）已删；本地 studio 3071/3075 + 画廊 3072 已关。
诊断备份在 `notes/2026-06-06-studio-session-verify-bold/`（未追踪，含原始 messages/graph + DIAGNOSIS.md）。

**仍未追踪不进版本库**（Joey 未定）：`research/render-all-previews.sh` / `repick-posters.sh` / `preview-renders/` / `preview-renders.old-*/` / spec-08/09 md / 上述 notes 目录。

## 会话进度（2026-06-05）— 新模板 frame-bold-poster，**已做完 + studio 验证，git 待定**

> 上一会话在 `feat/template-bold-poster` 分支做了一个新模板 `frame-bold-poster`（暖白纸底 +
> 番红 + 巨型倾斜 Shrikhand 大字的 1970s 欧洲社论海报风），未提交即中断。本轮接续：核对 + 验证。

- ✅ 接续盘点：当前在 `feat/template-bold-poster` 分支（HEAD = main = origin/main = `cecbe0a`，三者同步）。
  唯一在制品 = 未追踪目录 `templates/frame-bold-poster/`（template.html-video.yaml + SKILL.md +
  example.md + package.json + preview.png + source/index.html）。**6/4 那轮 provenance 整改其实早已
  merge 进 main（commit `db31210`），下面 6/4 段里"待 commit"的说法已过时，勿再据此重复提交。**
- ✅ 核对新模板严格遵循 RFC-07：三层署名齐全 —— origin = "1970s 欧洲社论海报传统"（标 `kind: movement`，
  诚实地不伪造具体工作室）/ via_skill = frontend-slides · Zara Zhang · MIT · 指向具体上游
  `bold-template-pack/templates/bold-poster/design.md` / transformation 声明为原创 CSS keyframes、
  调色与字体栈跟随上游 spec、**未照搬上游 HTML**。
- ✅ 查重：与已有 `frame-bold-signal`（同样 frontend-slides 派生）**不撞车** —— bold-signal 是深色底
  `#1a1a1a` + Archivo Black + 橙红 `#FF5722`、源自 `STYLE_PRESETS.md` preset、origin=none；
  bold-poster 是暖白 `#F5F2EF` + Shrikhand/Libre Baskerville 衬线 + 番红 `#D8000F`、源自具体上游模板。
- ✅ 验证：① `pnpm -r build` 全过；② CLI `search-templates` 重读磁盘 → 27 模板齐全，bold-poster
  排第一（score 0.8）engine_installed=true license OK；③ 起 studio 到 **3071**（旧会话的 3074 还占着、
  跑旧状态），`/api/templates` 确认 bold-poster present=true。`prefers-reduced-motion` 终态也处理了。
- ⏳ **git 待定（Joey 6/5 决定先在本地 studio 看效果再说）**：本轮**不动 git**，未 commit / 未 push /
  未开 PR。待 Joey 在 studio 看完动效后，再决定 commit + 开 PR（按约定模板/公开内容走 PR review）。
  studio 运行中：`http://localhost:3071`（pid 见 `/tmp/hv-studio-3071.log`）。

## 会话进度（2026-06-04）— 模板来源/署名整改，**已完成并 merge 进 main（`db31210`）**

> 起因：Joey 发现新加的模板与已有模板视觉撞车，且"原创"声明未经核实。
> 做了一次全量来源审计 + 定转换规范 + 按规范整改了 6 个模板的署名。

**审计与规范（前半段）：**
- ✅ 回退了今天误加的 3 个重复模板 commit（`abd8168`，曾是 build-metrics / pentagram-benchmark /
  takram-radar）。`git reset --hard origin/main` 回到 26 个模板的干净状态，HEAD = `166fdc1`。
  → **结论：这 3 个是已有 huashu 系模板的"+3指标数据"换皮变体，不要再加回来。**
- ✅ 真实 clone 两个上游核实 license（都真是 MIT）+ 记下**真实版权人**：
  - huashu-design → `alchaincyf（花叔 · 花生）` © 2026
  - frontend-slides → `Zara Zhang` © 2025
- ✅ 关键发现：Pentagram / Build / Takram **不是 huashu 原创**，是 huashu 在致敬真实设计工作室
  （Pentagram=Michael Bierut / Build=伦敦工作室 / Takram=日本公司）。署名是**三层**不是两层。
  且我们模板示例数据（95.7/73.8/AIME/SWE）是从上游 ppt 页照搬的。
- ✅ 写了审计报告 `notes/2026-06-04-provenance-audit.md`（未提交）
- ✅ 写了转换规范 **`research/2026-06-04-spec-07-ppt-to-template.md`（RFC-07，未提交）** —— 含三层
  署名 schema（origin/via_skill/transformation）+ 命名规范 + 转换质量门槛 + 查重 + 交付清单。
  Joey 已认可此规范，后续按它走。
- ✅ 决定：**"默认渲染效果"不另做 loop.mp4**。studio 预览弹窗已用 `mode:'iframe'` 实时跑动画，
  用户在 studio 能直接看动效；preview.png 只做 studio 之外（README/官网）的静态兜底。

**整改（后半段，本轮做完）—— 6 个模板按 RFC-07 补三层署名，只补署名不改名：**
- ✅ 6 个模板的扁平 `provenance.inspired_by` 全部换成三层结构
  `origin`（L1 真实工作室）/ `via_skill`（L2 skill+真实作者全名+license+具体 source_file）/ `transformation`：
  - huashu 系 source_file = `assets/showcases/ppt/ppt-{pentagram,build,takram}.html`，
    origin 分别 = Pentagram(Michael Bierut) / Build(伦敦工作室) / Takram(日本公司)。
  - frontend-slides 系 source_file = `STYLE_PRESETS.md`（preset "Bold Signal"/"Creative Voltage"/
    "Electric Studio"），**origin 诚实标 `none`** —— 这三个是 skill 作者自组的原创 preset，没特定 L1 工作室。
  - via_skill.author 填真实全名：`alchaincyf (花叔 · 花生)` / `Zara Zhang`（上游 LICENSE 核实过）。
- ✅ 遵守 Joey 决定（6/4）：本轮**只补 provenance 三层 + 真实作者名，未改 id/显示名/示例数据**
  （命名挪用工作室名的问题留下一轮）。
- ✅ 新建根 `ATTRIBUTIONS.md` 汇总两个上游 + license + 每个模板的 L1/L2 映射 + "not affiliated" 声明。
- ✅ 验证：① 用项目 `yaml@2.9.0` 直接解析 6 文件 → 三层字段齐全、无 `inspired_by` 残留、语法 OK；
  ② 全新 CLI 进程 `search-templates` 重读磁盘 → 6 个模板全部正常加载（license/best_for/duration 都对）；
  ③ studio(localhost:3074) `/api/templates` 24 模板齐全。注：provenance **不进** API / UI 渲染路径
  （studio 只用 source HTML + inputs schema + poster），本轮没碰这些，渲染逻辑上不受影响。

**待办（下次接）：**
- ~~commit + push~~ → **已于 6/4 完成并 merge 进 main（`db31210`）**，此条作废。
- ⏳ 下一轮（独立）：按 RFC-07 ③ 给 6 个模板**重命名**（去掉挪用的工作室名，改设计特征中性名，
  如 `frame-editorial-anchor` / `frame-luxe-minimal` / `frame-soft-radar`），涉及改 id 要同步 source 目录名 + 引用。

> 笔误备忘：本项目正确写法是 **hyperframes**（不是 hiframes/HiFrames），文档里如再见到要改。
> 上游 clone 仍在 `~/Desktop/claude-code/scratch/upstream-check/`（huashu-design + frontend-slides，可能被定期清理）。

## 跑起来

```bash
cd ~/Desktop/claude-code/projects/html-video
pnpm install
pnpm -r build
pnpm --filter @html-video/cli smoke

# CLI 直接跑
./packages/cli/dist/bin.js doctor
./packages/cli/dist/bin.js search-templates --intent "github stars" --top 3
```

## 与姊妹项目的关系

| 项目 | 角色 | 关系 |
|---|---|---|
| `open-design` (T5) | OD 主线 maintainer 工作树 | 设计资产侧；本项目是视频侧；同 nexu-io org，可以共享部分 skill 基建 |
| `html-anything` | OD 的 sister 开源（HTML 模板/页面） | 命名同 family（"HTML X"），定位互补：HA 做 HTML 静态页、本项目做 HTML 视频 |
| `od-pitch` (T6) | 路演 deck | 启动时如果做 launch deck，可以复用 od-pitch 的 magazine/recruiting 同款风格 |
| `growth-dashboard` (T7) | 数据罗盘 | 上线后增加 html-video 的 stars/forks/issues 监控 |

## 写操作守则

- 任何对外 publish 动作（CF Pages / GitHub repo create / 推 main / launch tweet / 公众号）**每次都先告诉 Joey**
- 改动 README.md 这种"公开门面"前先 review，避免误更新对外定位
- 第一次 push 到 nexu-io/html-video 是高敏感动作，要 Joey 明确点头 + 选好 launch 时机

## 命名 & 标语备忘

- 项目名：`html-video`
- 公司名 / org: `nexu-io`
- 推荐 tagline 候选：
  - "HTML→Video meta-layer for coding agents"（直白）
  - "Bring your agent. Pick any engine. Render any video."（口号化）
  - "One agent, every HTML video engine."（最短）
- 选哪个等公开发布前定
