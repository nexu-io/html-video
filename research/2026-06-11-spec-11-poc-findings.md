# RFC-11 Phase-0 最小 PoC — 验证结论

> **Date**: 2026-06-11 · **Status**: ✅ 跑通（合成素材自验，待 Joey 拿真实录像复跑）
> **配套**: `2026-06-11-spec-11-footage-edit.md`（§9 开放问题 5）
> **Driver（不进库）**: `~/Desktop/claude-code/scratch/hv-footage-edit-poc/`（`edit.py` + 合成 takes + 产物）

## 验证目标

只验 Phase-0 最高风险假设：**takes → 转录（词时间戳）→ 选片（带书面理由）→ 帧精确切 → concat-filter 拼 → 重转录自检**，全程决策以 JSON/文本存在。不动 schema/adapter 抽象。

## 工具链（本机实测）

| 工具 | 结果 |
|---|---|
| ffmpeg / ffprobe | 8.1.1 ✅（注意：brew 版**没链 freetype，`drawtext` 不可用**——测试片改用纯色底区分） |
| ASR | `whisper-cpp`（brew 装）+ `ggml-base.en.bin`（141M，从 HF 下）✅ 本机 Metal 跑 |
| TTS 造素材 | macOS `say -v Samantha` ✅ |
| whisper word-level | `whisper-cli -m M -f x.wav -ml 1 -sow -oj` → 每词一段带 `offsets.from/to`（毫秒）✅ |

## 合成素材

3 scene / 7 take（每 scene 后面的 take 更干净），刻意埋：① 填充词 um/uh；② intro 开头 "Hey everyone" 暖场需切掉。复刻 deck 场景。

## 结果（端到端一次通过）

```
选片：scene1→C003 / scene2→C005 / scene3→C007（全选到零填充词的那条，带 rationale）
intro 暖场切除：final scene1 从 "it's…" 起，"Hey everyone" 已去（cut-in 0.92s 落静音间隙）
拼接：3 段 sum=7.82s → final.mp4 7.84s，concat drift 0.02s（PTS 正确，concat-filter 教训成立）
全解码：clean，单 video + 单 audio 流
重转录自检：「It's Therick from the Claude Code team. Claude is a really great thought
            partner for coding. We verify every single change before we ship it.」
            → 填充词 = NONE ✓，三段顺序正确
```

## 关键发现 → 回填 spec

1. **whisper 错词、时间戳准**——复刻 deck 现象：「Thariq→Theric」「uh→"Ah!"」「um→"um"」，但 `from/to` 毫秒级可靠，**切点足够准**。验证了 spec §7「转录质量决定下游」+「重转录自检兜底」的设计。
2. **填充词检测要按归一化 token 匹配**——TTS 把 "uh" 读成 "Ah!"，标点/引号混入，必须 `re.sub('[^a-z]','')` 归一后再比 FILLER 集。
3. **混流拼接结论同样适用于纯素材切片**——concat-filter 重建 PTS，drift 0.02s；若用 concat demuxer 拼重编码段会累加时间戳（本项目 6/7 已踩）。
4. **brew ffmpeg 无 drawtext**——后续若要烧字幕/水印走别的路径（Remotion 浮层合成，正好是 Phase 1）。
5. **EDL = content-graph 投影成立**——PoC 的 `final-edit.json`（footage 节点 + sequence 边 + rationale）就是 spec §3 提议的泛化结构的雏形，直接可演进。

## 真实素材复跑发现（2026-06-11，Joey 提供一条中文口播）

拿一条真实手机口播（竖屏 1080×1920 / 16s / 中文）复跑，暴露一个**重要产品风险**：

- **whisper 在听不懂的语言上会幻觉**：`base.en` 和 `base`(auto) 把这条**中文**音频幻觉成一段**英文** YouTube 式字幕（"…please let us know in the comments below. See you in the next video." —— 这些是 whisper 训练集里的经典幻觉残留）。用普通模式复查 + 换 `small`+`-l zh` 才得到真实内容。
- **三条教训 → 回填 spec**：
  1. **语言/模型选择是一等风险**，不能默认 `en`、`auto` 也可能误判。`SourceAdapter` 应支持/鼓励显式 `language`，并对"高置信幻觉短语"give warning；小语种/中文要用 ≥`small` 模型。
  2. **`-ml 1 -sow` 在短片段 + 弱模型上更易幻觉**；whole-clip 转录比逐段稳。验证类输出必须看内容、不能只看"有没有 filler"（filler=0 也可能是整段幻觉）。
  3. **"重转录自检"正是兜底**：它能抓住"切出来是垃圾"的情况——这是 spec §7 设计的价值实证。
- **另一个 scope 发现**：这条是**单条连续 take**（非多 take）。Phase-0 CLI 以"整文件=一条 take"为单位，**单文件内按句切**（transcript-span 级剪辑）是真实存在的需求但不在 Phase-0；可作 Phase-1.5。单 take 上能演示的是"剪辑即文本"（改 EDL span 删句重渲），不是"多 take 选优"。

## 结论

**Phase-0 的核心循环在本机真能跑通、可看成片、可自检。** spec §9 开放问题 5（要不要先 PoC）已用事实回答：**值得正式立项做 Phase-0**——风险点（ASR 词时间戳）已排除，剩下是把这套 driver 工程化进 `core` + `SourceAdapter` + content-graph `footage` 节点。
