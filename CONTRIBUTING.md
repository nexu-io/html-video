# Contributing to html-video

> **English** · [中文](#中文)

Thank you for your interest in contributing! html-video is an Apache-2.0 project by the [Open Design](https://github.com/nexu-io/open-design) team. We welcome contributions of all kinds — code, docs, templates, bug reports, and ideas.

---

## Community

- **Discord**: [Join the Open Design Discord](https://github.com/nexu-io/open-design#community) — the main hub for questions, design discussions, and real-time help.
- **X (Twitter)**: Follow [@nexudotio](https://x.com/nexudotio) for project updates.
- **GitHub Issues**: Bug reports, feature requests, and template proposals all go here.

---

## Development Setup

### Prerequisites

| Requirement | Minimum Version | How to check |
|---|---|---|
| **Node.js** | 20+ | `node --version` |
| **pnpm** | 9+ | `pnpm --version` |
| **ffmpeg** | Any recent | `ffmpeg -version` |
| **Chromium** (or Playwright browsers) | See below | `npx playwright install chromium` |

**Why Chromium?** The default [Hyperframes](https://github.com/heygen-com/hyperframes) engine renders videos by recording animated HTML in a headless Chromium browser. You need either:

- A system Chromium/Chrome install (auto-detected), or
- Playwright's bundled Chromium: `npx playwright install chromium`

**Why ffmpeg?** After recording each frame as WebM, ffmpeg encodes them to MP4 (libx264) and concatenates them into the final video. It's also used for the optional AI soundtrack mixing.

### Clone, Install, Build

```bash
git clone https://github.com/nexu-io/html-video.git
cd html-video
pnpm install
pnpm -r build
```

This is a **pnpm workspace monorepo**. All packages live under `packages/` and templates under `templates/`. The `pnpm -r build` command builds every package in dependency order.

### Run Locally

**Studio (browser UI):**

```bash
node packages/cli/dist/bin.js studio
# Opens at http://127.0.0.1:3071
```

**CLI tools:**

```bash
# Check what's installed and ready
node packages/cli/dist/bin.js doctor

# Search templates by intent
node packages/cli/dist/bin.js search-templates --intent "data chart" --top 5
```

---

## Project Structure

```
packages/
├── core/                  Types, registries, orchestrator, MiniMax + ffmpeg audio
├── content-graph/         Multi-frame storyboard IR (nodes + edges, topo-sort)
├── runtime/               Agent runtime — detect / spawn / stream (13 agents)
├── adapter-hyperframes/   Hyperframes engine adapter — Chromium + ffmpeg render
├── cli/                   `html-video` command + studio HTTP server + source fetching
└── project-studio/        Browser studio UI (chat, gallery, frames, soundtrack, export)
templates/                 21 curated, license-clean video templates
research/                  RFCs (engine adapter / template metadata / agent skill / content-graph)
```

---

## How to Add a New Agent Runtime

Adding support for a new coding agent is the most common contribution. It's a self-contained change in `packages/runtime/`.

**Pattern (from Trae CLI PR #12):**

### 1. Create the agent definition file

`packages/runtime/src/defs/<agent>.ts`:

```ts
import type { AgentDef } from '../types.js';

export const myAgent: AgentDef = {
  id: 'my-agent',              // kebab-case, stable
  name: 'My Agent',            // Human-readable
  bin: 'my-agent-cli',         // CLI binary name (looked up on PATH)
  versionArgs: ['--version'],  // Args to check version (for `doctor`)
  buildArgs(prompt, ctx) {     // Build spawn arguments
    return ['--print', prompt];
  },
  streamFormat: 'plain',       // 'plain' | 'claude-stream' | 'json-event-stream' | 'acp-json-rpc'
  promptViaStdin: false,       // true if sending prompt via stdin
  installUrl: 'https://example.com/install',  // Where users can get it
};
```

See `packages/runtime/src/types.ts` for the full `AgentDef` interface — it supports ACP JSON-RPC agents, HTTP-based agents (like the Anthropic API), binary fallbacks, and extra availability checks.

### 2. Register the agent

In `packages/runtime/src/registry.ts`, import and add your agent to the `AGENT_DEFS` array:

```ts
import { myAgent } from './defs/my-agent.js';

export const AGENT_DEFS: AgentDef[] = [
  // ... existing agents
  myAgent,
];
```

Order matters: the first available agent is the default selection in the studio.

### 3. Test

```bash
pnpm --filter @html-video/runtime build
node packages/cli/dist/bin.js doctor  # Your agent should appear if its binary is on PATH
```

---

## How to Add a New Template

Templates live under `templates/<id>/` and are described by a `template.html-video.yaml` manifest. The studio scans templates at startup and the agent reads the manifest to understand what the template does and what inputs it needs.

### Minimum structure

```
templates/frame-my-cool-animation/
├── template.html-video.yaml   # Required — see format below
├── source/index.html          # Required — the animated HTML (Hyperframes engine)
├── SKILL.md                   # Agent-readable instructions for filling in the template
├── example.md                 # Example input
└── poster.svg / preview.png   # Static preview image
```

### Provenance rules (RFC-07)

Every template MUST follow the [RFC-07 provenance rules](research/2026-06-04-spec-07-ppt-to-template.md):

1. **License gate**: Only permissive open-source licenses (MIT, Apache-2.0, BSD, CC-BY, CC-BY-SA). No NC, ND, or unlicensed sources.
2. **Three-layer attribution**: L1 (original design studio/designer) → L2 (skill/upstream author) → L3 (our transformation). All three must be recorded in `provenance`.
3. **Naming**: Use descriptive feature names, not studio/designer names. ❌ `frame-pentagram-stat` → ✅ `frame-editorial-anchor`
4. **Transformation quality**: Must add real animation timeline, use own sample data, and have identifiable redesign from the upstream source.
5. **Deduplication**: Check against existing templates from the same upstream. Don't ship near-identical variants.

### manifest.yaml skeleton

```yaml
spec_version: 1
id: frame-my-cool-animation
name: My Cool Animation
description: A short description for agents and the gallery.
engine: hyperframes
category: title-card
tags: [animation, reveal]
best_for:
  - "Product launch teasers"
  - "Social media shorts"
inputs:
  schema:
    type: object
    required: [title]
    properties:
      title: { type: string, description: "Main headline" }
      subtitle: { type: string, description: "Subtitle line" }
  examples:
    - title: "Hello World"
      subtitle: "This is an example"
output:
  formats: [mp4]
  default_format: mp4
  duration: { type: variable, min_sec: 3, max_sec: 15 }
license:
  spdx: Apache-2.0
  attribution_required: false
  redistribution_allowed: true
  commercial_use: true
provenance:
  origin:
    name: "Original Designer / Studio"
    kind: design-studio
    reference: "https://example.com"
  via_skill:
    name: upstream-skill-name
    author: "Author Name"
    url: https://github.com/author/upstream
    license: MIT
    source_file: path/to/source.html
  transformation: >
    Static design → animated Hyperframes timeline with CSS @keyframes.
    Re-colored, original sample data.
```

See [RFC-02](research/2026-05-26-spec-02-template-metadata.md) for the complete `template.html-video.yaml` specification.

---

## How to Add a New Engine Adapter

The engine adapter interface ([RFC-01](research/2026-05-26-spec-01-engine-adapter.md)) lets any video rendering backend plug into html-video. The shipped adapter is `@html-video/adapter-hyperframes` — use it as the reference implementation.

### 1. Create a new package

```
packages/adapter-<engine>/
├── package.json
├── src/
│   ├── index.ts          # Export default EngineAdapter instance
│   ├── capabilities.ts   # Static capability declaration
│   ├── validate.ts       # Validate a template for this engine
│   └── render.ts         # Core render implementation
└── tsconfig.json
```

### 2. Implement the EngineAdapter interface

The core contract is defined in `packages/core/src/types.ts`:

```ts
export interface EngineAdapter {
  id: EngineId;
  name: string;
  upstreamVersion: string;
  capabilities: EngineCapabilities;
  validate(template: Template): ValidationResult;
  render(input: RenderInput, ctx: RenderContext): Promise<RenderOutput>;
  preview?(template: Template, ctx: PreviewContext): Promise<PreviewHandle>;
  listNativeTemplates?(): Promise<NativeTemplateRef[]>;
}
```

Key conventions from RFC-01:

- **Process isolation**: Each `render()` spawns an independent subprocess. Subprocess crashes must reject the promise and leave no partial output files.
- **Progress reporting**: 0-100% based on current frame / total frames. Stage hints: `preparing` (0-10%), `rendering` (10-95%), `muxing` (95-100%).
- **Cancellation**: Respect `ctx.signal.aborted` — kill subprocess, cleanup workDir temp files, reject with `AbortError`.
- **Package naming**: `@html-video/adapter-<name>`, peer-depend on the upstream engine.

### 3. Register in core

The core dynamically loads adapters — once your package is in `packages/` and listed in `pnpm-workspace.yaml`, it will be auto-discovered at runtime.

---

## Code Style

- **Language**: TypeScript (strict mode, `tsconfig.base.json` inheritance)
- **Formatting**: [Biome](https://biomejs.dev/) — 2 spaces, single quotes, trailing commas, semicolons, LF line endings. Run `pnpm format` to auto-format.
- **Linting**: `pnpm lint` runs Biome linter with recommended rules.
- **Monorepo tooling**: pnpm workspaces, `pnpm -r build` builds all packages in order.
- **Imports**: Use `.js` extensions in TypeScript imports (for ESM compatibility).

### Before submitting

```bash
pnpm typecheck    # TypeScript across all packages
pnpm lint         # Biome linter
pnpm format       # Auto-format all files
pnpm test         # Run all tests
```

---

## How to Submit a Pull Request

1. **Fork** the repository and create a branch from `main`.
2. **Make your changes** — keep them focused. One PR = one logical change.
3. **Test your changes** — run `pnpm typecheck && pnpm lint && pnpm test`.
4. **Write a clear commit message** — follow conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
5. **Open a PR** against `nexu-io/html-video:main`.
6. **Describe** what you changed, why, and how to verify it.

We review PRs regularly. If your PR adds a new feature, link to or include related tests.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE) — same as the rest of the project. No contributor license agreement (CLA) is required.

---

## Questions?

- **Real-time chat**: Join the [Open Design Discord](https://github.com/nexu-io/open-design#community)
- **Bugs & features**: Open an issue on [GitHub](https://github.com/nexu-io/html-video/issues)
- **Design decisions**: Read the RFCs in [`research/`](research/)

---

## 中文 {#中文}

感谢你有意为 html-video 贡献！html-video 是 [Open Design](https://github.com/nexu-io/open-design) 团队维护的 Apache-2.0 项目。我们欢迎所有形式的贡献 —— 代码、文档、模板、bug 反馈和想法。

### 社区

- **Discord**：[加入 Open Design Discord](https://github.com/nexu-io/open-design#community) — 主要的问答、设计讨论和实时求助渠道。
- **X（Twitter）**：关注 [@nexudotio](https://x.com/nexudotio) 获取项目动态。
- **GitHub Issues**：提 bug、功能建议、模板提案都来这里。

### 开发环境搭建

#### 前置依赖

| 依赖 | 最低版本 | 检查方式 |
|---|---|---|
| **Node.js** | 20+ | `node --version` |
| **pnpm** | 9+ | `pnpm --version` |
| **ffmpeg** | 任意较新版本 | `ffmpeg -version` |
| **Chromium**（或 Playwright 浏览器）| 见下文 | `npx playwright install chromium` |

**为什么需要 Chromium？** 默认的 [Hyperframes](https://github.com/heygen-com/hyperframes) 引擎用无头 Chromium 录制带动画的 HTML 来渲染视频。你需要以下之一：

- 系统安装的 Chromium/Chrome（自动检测），或
- Playwright 内置的 Chromium：`npx playwright install chromium`

**为什么需要 ffmpeg？** 渲出每帧 WebM 后，ffmpeg 将它们编码为 MP4（libx264）再拼接成最终视频。可选的 AI 配乐混音也要用到它。

#### 克隆、安装、构建

```bash
git clone https://github.com/nexu-io/html-video.git
cd html-video
pnpm install
pnpm -r build
```

这是 **pnpm workspace 单体仓库**。所有包在 `packages/` 下，模板在 `templates/` 下。`pnpm -r build` 按依赖顺序构建所有包。

#### 本地运行

**Studio（浏览器界面）：**

```bash
node packages/cli/dist/bin.js studio
# 在 http://127.0.0.1:3071 打开
```

**CLI 工具：**

```bash
# 查看已安装并可用的 agent 和引擎
node packages/cli/dist/bin.js doctor

# 按意图搜索模板
node packages/cli/dist/bin.js search-templates --intent "数据图表" --top 5
```

### 如何添加新的 Agent 运行时

添加对新 coding agent 的支持是最常见的贡献类型。改动集中在 `packages/runtime/` 内。

**模式（参考 Trae CLI PR #12）：**

#### 1. 创建 agent 定义文件

`packages/runtime/src/defs/<agent>.ts`：

```ts
import type { AgentDef } from '../types.js';

export const myAgent: AgentDef = {
  id: 'my-agent',              // kebab-case，稳定不变
  name: 'My Agent',            // 可读名称
  bin: 'my-agent-cli',         // CLI 二进制名（在 PATH 上查找）
  versionArgs: ['--version'],  // 检查版本的参数（给 `doctor` 用）
  buildArgs(prompt, ctx) {     // 构建启动参数
    return ['--print', prompt];
  },
  streamFormat: 'plain',       // 'plain' | 'claude-stream' | 'json-event-stream' | 'acp-json-rpc'
  promptViaStdin: false,       // 是否通过 stdin 传递 prompt
  installUrl: 'https://example.com/install',  // 安装指引链接
};
```

完整 `AgentDef` 接口见 `packages/runtime/src/types.ts` —— 它支持 ACP JSON-RPC agent、基于 HTTP 的 agent（如 Anthropic API）、二进制回退路径和额外的可用性检查。

#### 2. 注册 agent

在 `packages/runtime/src/registry.ts` 中 import 并将你的 agent 加入 `AGENT_DEFS` 数组：

```ts
import { myAgent } from './defs/my-agent.js';

export const AGENT_DEFS: AgentDef[] = [
  // ... 已有 agent
  myAgent,
];
```

顺序很重要：第一个可用的 agent 是 studio 的默认选项。

#### 3. 测试

```bash
pnpm --filter @html-video/runtime build
node packages/cli/dist/bin.js doctor  # 如果二进制在 PATH 上，你的 agent 应该出现
```

### 如何添加新模板

模板放在 `templates/<id>/` 下，由 `template.html-video.yaml` 清单描述。studio 启动时扫描模板，agent 读取清单来了解模板用途和输入需求。

#### 最小目录结构

```
templates/frame-my-cool-animation/
├── template.html-video.yaml   # 必选 —— 格式见下文
├── source/index.html          # 必选 —— 带动画的 HTML（Hyperframes 引擎）
├── SKILL.md                   # Agent 可读的填参说明
├── example.md                 # 示例输入
└── poster.svg / preview.png   # 静态预览图
```

#### 来源规范（RFC-07）

每个模板必须遵守 [RFC-07 来源规范](research/2026-06-04-spec-07-ppt-to-template.md)：

1. **许可闸门**：只收明确宽松开源的许可（MIT、Apache-2.0、BSD、CC-BY、CC-BY-SA）。不收 NC、ND 或无许可的来源。
2. **三层署名**：L1（原始设计工作室/设计师）→ L2（skill/上游作者）→ L3（我们的转化）。三层都必须记在 `provenance` 里。
3. **命名**：用描述设计特征的名字，不要挪用工作室/设计师名。❌ `frame-pentagram-stat` → ✅ `frame-editorial-anchor`
4. **转化质量**：必须新增真实的动效时间线、用自有示例数据、相比上游有可辨别的再设计。
5. **查重**：跟同一上游来源的已有模板比对，不提交几乎一样的变体。

### 如何添加新引擎适配器

引擎适配器接口（[RFC-01](research/2026-05-26-spec-01-engine-adapter.md)）让任何视频渲染后端都能接入 html-video。已发布的适配器是 `@html-video/adapter-hyperframes` —— 用它作为参考实现。

#### 1. 创建新包

```
packages/adapter-<engine>/
├── package.json
├── src/
│   ├── index.ts          # 导出默认 EngineAdapter 实例
│   ├── capabilities.ts   # 静态能力声明
│   ├── validate.ts       # 校验模板能否被本引擎渲染
│   └── render.ts         # 核心渲染实现
└── tsconfig.json
```

#### 2. 实现 EngineAdapter 接口

核心契约定义在 `packages/core/src/types.ts`，详见 [RFC-01](research/2026-05-26-spec-01-engine-adapter.md)。关键约定：

- **进程隔离**：每次 `render()` 启动独立子进程。子进程崩溃必须 reject promise，不留下不完整的输出文件。
- **进度报告**：按当前帧/总帧数算 0-100%。阶段提示：`preparing`（0-10%）、`rendering`（10-95%）、`muxing`（95-100%）。
- **取消**：响应 `ctx.signal.aborted` —— 杀掉子进程，清理 workDir 临时文件，reject `AbortError`。
- **包命名**：`@html-video/adapter-<name>`，peer-depend 上游引擎。

### 代码风格

- **语言**：TypeScript（strict 模式，继承 `tsconfig.base.json`）
- **格式化**：[Biome](https://biomejs.dev/) —— 2 空格缩进、单引号、尾逗号、分号、LF 换行。运行 `pnpm format` 自动格式化。
- **Lint**：`pnpm lint` 用 Biome linter 的推荐规则。
- **单体仓库工具链**：pnpm workspace，`pnpm -r build` 按顺序构建所有包。
- **Import**：TypeScript import 使用 `.js` 扩展名（ESM 兼容）。

#### 提交前检查

```bash
pnpm typecheck    # 全仓库 TypeScript 检查
pnpm lint         # Biome linter
pnpm format       # 自动格式化所有文件
pnpm test         # 运行所有测试
```

### 如何提交 Pull Request

1. **Fork** 仓库，从 `main` 创建分支。
2. **做出改动** —— 保持聚焦。一个 PR = 一个逻辑变更。
3. **测试你的改动** —— 运行 `pnpm typecheck && pnpm lint && pnpm test`。
4. **写清楚的 commit message** —— 遵循 conventional commits：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`。
5. **发起 PR** 到 `nexu-io/html-video:main`。
6. **描述**你改了什么、为什么、怎么验证。

我们会定期 review PR。如果你的 PR 加了新功能，请附带或链接相关测试。

### 许可

贡献即表示你同意你的贡献将按照 [Apache-2.0 许可](LICENSE) 授权 —— 和项目其他部分一致。不需要签署贡献者协议（CLA）。

### 有问题？

- **实时聊天**：加入 [Open Design Discord](https://github.com/nexu-io/open-design#community)
- **Bug 和功能**：在 [GitHub](https://github.com/nexu-io/html-video/issues) 提 issue
- **设计决策**：阅读 [`research/`](research/) 中的 RFC
