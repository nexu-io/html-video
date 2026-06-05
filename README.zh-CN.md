# html-video

<p align="center">
  <img src="docs/assets/hero.png" alt="html-video — 在你的电脑上，把 HTML 变成视频" width="100%" />
</p>

> **在你的电脑上，把 HTML 变成视频。** 接上你本地的 coding agent（Open Design · Windsurf CLI · Trae CLI · Claude Code · Cursor · Codex · Gemini · Grok · Qwen · OpenCode · Copilot · Aider · Hermes · 或 Anthropic API），描述一个视频，或者**直接粘一个文章链接 / GitHub 仓库**，agent 就把它变成一支多帧、带动画的视频 —— 然后就在你这台机器上渲染成真实 MP4。一个 agent 循环、可插拔渲染引擎、精选模板库、可选 AI 配乐。Apache-2.0，无单次渲染费用，不绑定厂商。

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <a href="#支持的-agent"><img alt="Agents" src="https://img.shields.io/badge/agents-14%20backends-111?style=flat-square" /></a>
  <a href="#作品展示"><img alt="Templates" src="https://img.shields.io/badge/templates-21-3ce6ac?style=flat-square" /></a>
  <a href="#把链接变成视频"><img alt="Sources" src="https://img.shields.io/badge/from-article%20%C2%B7%20repo%20%C2%B7%20prompt-9b59b6?style=flat-square" /></a>
  <a href="#配乐"><img alt="Soundtrack" src="https://img.shields.io/badge/soundtrack-AI%20music%20%2B%20narration-e67e22?style=flat-square" /></a>
  <a href="#快速开始"><img alt="Quickstart" src="https://img.shields.io/badge/quickstart-3%20commands-22a34a?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://github.com/nexu-io/open-design#community"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865f2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://x.com/nexudotio"><img alt="Follow @nexudotio on X" src="https://img.shields.io/badge/follow-%40nexudotio-000000?style=flat-square&logo=x&logoColor=white" /></a>
  <a href="https://github.com/nexu-io/open-design"><img alt="By the Open Design team" src="https://img.shields.io/badge/by-nexu--io%2Fopen--design-ff7043?style=flat-square&logo=github&logoColor=white" /></a>
</p>

<p align="center">
  <b>Open Design 团队官方出品</b> · <a href="https://open-design.ai">open-design.ai</a>
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

---

## 作品展示

下面每个模板都是一支真实、带动画的单文件 HTML 视频 —— 这些是实时渲染截图，不是效果图。挑一个，让 agent 填进你的内容，导出 MP4。

<table>
<tr>
<td width="50%"><img src="docs/assets/templates/frame-data-chart-nyt.png" alt="NYT 风格数据图表" /></td>
<td width="50%"><img src="docs/assets/templates/frame-glitch-title.png" alt="故障标题" /></td>
</tr>
<tr>
<td><b>frame-data-chart-nyt</b> · 数据可视化<br/>纽约时报风格的动态折线图 —— 大标题、标注数据点、来源行。适合「数字涨上去了」类叙事。</td>
<td><b>frame-glitch-title</b> · 标题卡<br/>带色彩偏移与扫描线的故障标题。适合开场、爆点、「系统上线」式的能量感。</td>
</tr>
<tr>
<td><img src="docs/assets/templates/frame-liquid-bg-hero.png" alt="液态背景主视觉" /></td>
<td><img src="docs/assets/templates/frame-light-leak-cinema.png" alt="漏光电影感" /></td>
</tr>
<tr>
<td><b>frame-liquid-bg-hero</b> · 主视觉<br/>极光液态渐变背景 + 居中大标题。适合产品发布与有力的口号。</td>
<td><b>frame-light-leak-cinema</b> · 电影感<br/>暖色胶片颗粒 + 漏光的电影感画面。适合氛围片、品牌片、叙事短片。</td>
</tr>
<tr>
<td><img src="docs/assets/templates/vfx-text-cursor.png" alt="打字机光标特效" /></td>
<td><img src="docs/assets/templates/frame-logo-outro.png" alt="Logo 片尾" /></td>
</tr>
<tr>
<td><b>vfx-text-cursor</b> · 特效<br/>打字机文字 + 闪烁的终端光标。适合代码风揭示、CLI 演示。</td>
<td><b>frame-logo-outro</b> · 片尾<br/>干净的 Logo 动画结束卡。适合任何视频结尾的署名与品牌落版。</td>
</tr>
</table>

……还有 15 个，包括多场景产品宣传、动感排版、瑞士网格与 Vignelli 数据卡、决策树解说、Takram 有机动效、暖色颗粒杂志风。全部 21 个都可在 studio 模板库里实时浏览。

---

## 为什么做这个

HTML→Video 是个真实存在的品类 —— 但每个引擎都各有主张，且都要你学*它自己*的创作模型：

| 引擎 | 范式 | 取舍 | 在 html-video 中 |
|---|---|---|---|
| [Hyperframes](https://github.com/heygen-com/hyperframes) | HTML + CSS + GSAP，agent skill 驱动 | 单一渲染范式 | ✅ **已发布** —— 默认引擎；经无头 Chromium + ffmpeg 渲染出真实 MP4 |
| [Remotion](https://www.remotion.dev/) | React 组件 | source-available，4 人以上收费 | 🗺️ 计划中 |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) · [Revideo](https://github.com/redotvideo/revideo) | canvas 上的 TypeScript 生成器 | 最适合解说类、代码优先 | 🗺️ 计划中 |
| [Manim](https://github.com/3b1b/manim) 等 | 数学 / 3D 优先 | 小众 | 🗺️ 调研中 |

按场景挑引擎、学每一种创作模型、再把它们拼成一条工作流，都要耗真实的工程时间。多数团队挑一个、然后忍受它的局限。

**html-video 是凌驾于它们之上的 meta-layer。** 你跟 agent 对话，它挑引擎、挑模板、填进你的内容、渲染视频。引擎只是一个适配器接口背后的实现细节 —— 一份 `render(input, ctx)` 契约，任何后端满足它即可接入。加一个新引擎，所有模板、所有 agent、整条 studio 工作流就都自动用上了。不用学新的 DSL，换引擎也不用重写。

同一套思路也驱动着 [Open Design](https://github.com/nexu-io/open-design) 在*设计*领域的产品 —— 凌驾于众多工具之上的 agent meta-layer。html-video 是同一团队在*动态视频*这一面的对应物。

> **状态：** 可插拔引擎架构已就位，**Hyperframes 引擎已完整接通、能渲染出真实 MP4** —— 无头 Chromium 逐帧录制带动画的 HTML，再用 ffmpeg 编码（libx264）。Remotion、Motion Canvas / Revideo、Manim 在路线图上：适配器接口已为它们设计好，但适配器本身还没写。上表「在 html-video 中」这一列，是当下真正可运行内容的唯一权威来源。

---

## 速览

| | |
|---|---|
| **Coding agent（14 个）** | Open Design (Vela) · Windsurf CLI · Trae CLI · Claude Code · Cursor Agent · Codex CLI · Gemini CLI · Grok Build · Qwen Code · OpenCode · GitHub Copilot CLI · Aider · Hermes · Anthropic Messages API —— 在 `PATH` 上自动探测，顶栏一键切换。 |
| **真实 MP4 渲染** | 无头 Chromium 录制带动画的 HTML，ffmpeg 编码（libx264）—— 全在本地，无云端渲染，无单片费用。 |
| **文章 / 仓库 → 视频** | 粘一个 URL 或 GitHub 仓库；studio 在服务端抓取（支持微信公众号文章），用真实内容生成视频。 |
| **21 个模板** | 精选、许可清晰的样式：数据可视化、产品宣传、社媒短片、解说、动感排版、转场 —— 在模板库里实时预览。 |
| **多帧故事板** | content-graph 驱动多场景视频；逐帧改文案、重排、重渲染。 |
| **AI 配乐** | 可选背景音乐 + 旁白（MiniMax），导出时混进 MP4。 |
| **Studio + CLI** | 一个本地浏览器 studio，外加一个可脚本化的 `html-video` CLI。 |
| **许可** | Apache-2.0 —— 无单次渲染费、无席位上限、无贡献者协议。 |

---

## 它如何工作

一句话（或一个链接）进去，一支真实 MP4 出来。不论你从一句 prompt、一篇文章还是一个仓库开始，管线都是同一条：

```
  prompt / 链接 / 仓库
        │
        ▼
  ① 来源抓取        studio 在服务端拉取 URL 或仓库，扁平成 Markdown
        │
        ▼
  ② agent 循环      agent 读素材 + 所选模板的风格，产出一份
        │           content-graph（故事板）+ 每帧一个 HTML 块
        ▼
  ③ content-graph   多帧中间表示 —— 节点（实体 / 数据 / 文本）+ 边（顺序 /
        │           依赖 / 对比）；拓扑排序成帧序与时长
        ▼
  ④ 逐帧 HTML       每个节点变成一个自包含、带动画的 HTML 帧，落到磁盘
        │
        ▼
  ⑤ Hyperframes 渲染 无头 Chromium 加载每一帧并录制（会自动延长时长
        │            以覆盖该帧自身的动画）→ 每帧一个 webm
        ▼
  ⑥ ffmpeg          每个 webm → mp4（libx264），再 concat 成一支视频；
        │            可选混入 MiniMax 的音乐 + 旁白
        ▼
      你的.mp4
```

第 ②–④ 步正是「meta-layer」所在：agent 决定故事板，引擎决定怎么画，两者互不渗透。第 ⑤ 步是引擎相关的 —— 以后换成 Remotion 或 Motion Canvas，只替换这一个环节，故事板和 agent 循环原封不动。全程在你本机运行；唯二的网络调用是可选的来源抓取和可选的配乐。

单帧视频走一条快速路径，跳过 content-graph —— 一个模板、一个 HTML，直接渲染。

---

## 把链接变成视频

这是大多数人最想要的用法：丢一个链接给 agent，拿回一支视频。agent 作为本地 CLI 运行、自身没有联网能力，所以 studio 在**服务端**抓取来源、把真实内容喂进生成 prompt —— 不用手动复制正文，像微信公众号这种无需登录的服务端渲染页面也直接能用。

```
你：   做一个解读视频  https://mp.weixin.qq.com/s/…
Agent：好，我读完了《用嘴剪视频的时代来了？…》这篇文章 — 这就基于它生成。下一步选风格。
→      一支多帧解说视频，基于文章的真实要点
```

- **网页文章** → 抓取并扁平成 Markdown。像**微信公众号**这种服务端渲染的页面开箱即用。
- **GitHub 仓库** → 通过公开 API 拉取简介、顶层结构、README —— 很适合做「解读某开源项目」的视频。
- **只给一句话** → 描述主题，agent 从零写内容。

无论哪种来源，它都会成为视频真正依据的素材 —— 不是套模板时的摆设。agent 读取抓来的内容，自己决定需要几个场景，写出一份 **content-graph 故事板**：要点变成帧，要点之间的关系（这个承接那个、这个对比那个）变成边，再把所选模板的视觉风格逐帧应用上去。于是一篇 1500 字的文章变成一支有节奏的多场景解说，每一句都能追溯回原文的某处；一个仓库变成一段「这个项目到底是什么」的结构化讲解。

---

## 快速开始

### 前置依赖

| 依赖 | 最低版本 | 检查方式 |
|---|---|---|
| **Node.js** | 20+ | `node --version` |
| **pnpm** | 9+ | `pnpm --version` |
| **ffmpeg** | 任意较新版本 | `ffmpeg -version` |
| **Chromium**（或 Playwright 浏览器）| — | `npx playwright install chromium` |

默认渲染引擎用无头 Chromium 录制带动画的 HTML，再用 ffmpeg（libx264）编码为 MP4。如果没有系统安装的 Chromium，装 Playwright 内置的：

```bash
npx playwright install chromium
```

### 安装 & 运行

```bash
pnpm install
pnpm -r build
node packages/cli/dist/bin.js studio    # 在 http://127.0.0.1:3071 打开 studio
```

在 studio 里：挑一个模板（或直接描述视频 / 粘链接），跟 agent 对话，逐帧改文案，加配乐，导出 MP4。

CLI 工具：

```bash
node packages/cli/dist/bin.js doctor                 # 探测已安装的 agent + 引擎
node packages/cli/dist/bin.js search-templates --intent "github stars race" --top 3
```

---

## 支持的 Agent

在 `PATH` 上自动探测；在 studio 顶栏切换当前 agent。studio 默认把 **Open Design (Vela)** 排在最前 —— 一次登录、多种模型、成本更低 —— 然后回落到第一个*可用*的 agent，保证新项目永远有一个能用的后端。

| Agent | 探测 | 调用 |
|---|---|---|
| **Open Design (Vela)** | `vela` / Open Design 应用内置 | ACP over stdio —— 在 Open Design 里登录一次，任选模型 |
| **Windsurf CLI** | `windsurf` | `windsurf --yolo`，ACP over stdio |
| **Trae CLI** | `traecli` | `traecli acp serve --yolo`，ACP over stdio |
| **Claude Code** | `claude` | `claude --print`，prompt 走 stdin |
| **Cursor Agent** | `cursor-agent` | `cursor-agent --print` |
| **Codex CLI** | `codex` | `codex exec`，prompt 走 stdin |
| **Hermes** | `hermes` | Hermes ACP CLI |
| **Gemini CLI** | `gemini` | prompt 走 stdin |
| **Grok Build** | `grok` | `grok -p <prompt>` |
| **Qwen Code** | `qwen` | prompt 走 stdin |
| **OpenCode** | `opencode` | `opencode run`，prompt 走 stdin |
| **GitHub Copilot CLI** | `copilot` | `copilot --allow-all-tools`，prompt 走 stdin |
| **Aider** | `aider` | `aider --message <prompt>` |
| **Anthropic API** | BYOK | 直连 Messages API —— 不装任何 CLI 也能用 |

什么都没装？配一个 Anthropic key，studio 直接走 Messages API。

---

## 配乐

给成片加上声音。在 **Settings → Audio** 填入 MiniMax API key，然后在每个项目的 **Soundtrack** 面板：

- **背景音乐** —— 描述一种情绪（`舒缓的电影感氛围，缓慢推进`），MiniMax 生成一段器乐。
- **旁白** —— 输入文案，MiniMax 朗读（TTS）。

两者都会通过 ffmpeg 混进导出的 MP4（音乐压低到人声之下，可选淡入淡出）。没配 key？studio 其余部分照常工作。

---

## 模板库

这 21 个模板不是随手凑的一堆 —— 每一个都是自包含、agent 可读的单元，由一份 `template.html-video.yaml` 清单描述，studio 启动时扫描加载。一份清单带齐了 agent 挑选和驱动这个模板所需的一切，根本不用打开 HTML：

- **它用来做什么** —— `category`、`tags`，外加一个 `best_for` 清单（如*「企业幻灯片」*、*「极简报告卡」*），`search-templates` 拿你的意图去匹配它。
- **它输出什么** —— 支持的分辨率、画幅比、fps、时长上下限、是否有 alpha 通道或音频。
- **要喂什么进去** —— 一份 `inputs` JSON schema，让 agent 精确知道要填哪些文本 / 数据槽位。
- **许可来源** —— 一个 SPDX 标识，外加明确的 `attribution_required` / `redistribution_allowed` / `commercial_use` 标志，以及一个指向上游来源 URL 的 `assets_attribution` 块。

最后这一点是刻意为之。每个模板都**从构造上就许可清晰**：fork 来的保留其原始许可，仓库根的 [`NOTICE.md`](templates/NOTICE.md) 记下每个来源与 SPDX，没有清晰宽松许可的一律不收。所以你可以把其中任何一个放进商业作品里，无需再做审查。模板覆盖数据可视化（NYT 风格图表、Swiss / Vignelli 网格）、标题与特效（故障、动感排版、打字机光标）、主视觉与电影感（液态渐变、漏光、暖色颗粒）、产品宣传（15 秒 / 30 秒多场景）、解说骨架（决策树）—— 而且格式是开放的，社区模板用同样的方式接入。

---

## 架构

```
packages/
├── core/                  Project / Asset / ContentGraph 类型、registry、orchestrator、
│                          MiniMax provider + ffmpeg 音轨混合
├── content-graph/         多帧故事板中间表示（节点 + 边，拓扑排序）
│ runtime/               Agent 运行时 —— 探测 / spawn / 流式
│                          （Open Design/Vela · Windsurf CLI · Trae CLI · Claude · Cursor · Codex · Gemini · Grok · Qwen · OpenCode · Copilot · Aider · Hermes · Anthropic API）
├── adapter-hyperframes/   Hyperframes 引擎适配器 —— 经 Chromium + ffmpeg 真实渲染
├── cli/                   `html-video` 命令 + studio HTTP server + 来源抓取
└── project-studio/        浏览器 studio UI（对话、模板库、帧、配乐、导出）
templates/                 21 个精选、许可清晰的视频模板
research/                  RFC（引擎适配器 / 模板元数据 / agent skill / content-graph）
```

---

## 路线图

- [x] 引擎适配器规范 —— 一个接口，N 个后端
- [x] 模板元数据格式 —— 许可优先、agent 可读
- [x] 多帧故事板工作流（content-graph）
- [x] Studio：实时模板库、agent 切换器、逐帧改文案
- [x] 来源素材：文章 / GitHub 仓库 → 视频
- [x] AI 配乐（MiniMax 音乐 + 旁白），导出时混合
- [x] 真实 MP4 渲染 —— Hyperframes 引擎经无头 Chromium + ffmpeg
- [x] Agent 模型选择 —— Open Design (Vela) 后端，实时模型目录
- [ ] Remotion / Motion Canvas / Revideo 适配器
- [ ] Agent skill 包 + 模板市场

---

## 参考与渊源

| 项目 | 在这里的角色 |
|---|---|
| [Open Design](https://github.com/nexu-io/open-design) | 姊妹项目 —— 设计 agent meta-layer；同一团队、同一理念 |
| [HTML Anything](https://github.com/nexu-io/html-anything) | 姊妹项目 —— 面向*静态*交付物的 HTML；html-video 是*动态*那一面 |
| [Hyperframes](https://github.com/heygen-com/hyperframes) | 已发布的引擎适配器；HTML+CSS+GSAP 渲染范式，也是若干 Apache-2.0 模板的来源 |

## 许可

[Apache-2.0](LICENSE)

## 出品

[nexu-io](https://github.com/nexu-io) —— [Open Design](https://github.com/nexu-io/open-design) 背后的团队。加入 [Discord](https://github.com/nexu-io/open-design#community) · 关注 [@nexudotio](https://x.com/nexudotio)。
