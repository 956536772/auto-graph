# brainstorm: geometry word problem to drawing

## Goal

让系统在用户输入几何计算题、应用题、竞赛题题干时，不再直接返回“请改为具体绘图请求”，而是能够从题干语义中抽取可绘制的几何对象与关系，优先生成图形，用于辅助理解与后续求解。

## What I already know

* 当前外部返回模式已经是 `instructions | clarification | error`，并且前端天然消费 `instructions`。
* 当前 `geometry-workflow.md` 明确要求：对“困难几何题”不要尝试，无法安全表示时返回 `mode:"error"`。
* 当前后端支持的 action 主要是点、线段、平行/垂线、圆、外接圆、内切圆、交点、多边形、角、角平分线。
* 当前系统更擅长“明确绘图命令”，例如“画三角形 ABC，并作其外接圆”；不擅长“题干式叙述”，例如“正方形内接正八边形，求边长”。
* 当前后端校验的是结构正确、引用正确、部分基础几何关系正确，不是完整几何证明。
* 对用户给出的示例题，系统失败的直接原因是 prompt 把它归类为“不支持直接求解这类几何计算题”。
* 但更深层的问题是：即使 prompt 放开，当前 action 集合也没有“正多边形”“点在线段按比例取点”“约束求交/自动布局”等高级构图原语，因此很多题干只能画“语义示意图”，很难立即画“严格满足全部约束的精确图”。

## Assumptions (temporary)

* 用户当前的核心目标是“先把题意图画出来”，而不是让系统一步完成严格求值。
* 对这类输入，允许系统忽略题目末尾的“求什么”，只提取前面的图形关系并作图。
* 当前已确认目标不是纯示意图，而是“半精确构图”：尽量补充更高阶原语，让图形更接近严格约束。

## Open Questions

* 暂无

## Requirements (evolving)

* 当输入是几何题题干时，系统应优先尝试抽取图形，而不是立即报 `error`。
* 系统应能识别题干里的对象、命名和基本关系，例如正方形 `ABCD`、点 `E/G/I/K` 分别在四边上、内部存在正八边形 `EFGHIJKL`。
* 当题干同时包含“构图信息”和“求解问题”时，系统第一阶段应优先返回图形构造结果。
* 第一阶段目标定为“题干转半精确构图”，不是纯示意图，也不是完整求解器。
* 为了提升题干作图准确度，后端/LLM 工作流需要支持一批激进版高阶构图原语，优先包括 `line_through_points`、`point_on_segment`、`point_on_line`、`divide_segment`、`regular_polygon`、`translate_point`、`point_on_circle`，并预留 `constraint_polygon`、`equal_length_point`、`point_by_ratio`、`parallel_through_point_to_segment`、`perpendicular_through_point_to_segment` 等能力。
* 若无法严格满足全部几何约束，系统默认优先返回“可执行的近似/部分构图 instructions”，并在 `responseText` 中明确说明，而不是直接失败。
* 系统仍应保留 `clarification` 路径，用于对象指代不清、题意缺失、命名冲突等情况。
* 高阶 action 不由前端直接执行。LLM 可以直出高阶 `instructions`，但后端需要统一做校验与降解，最终只向前端返回稳定的基础 action 集。
* 第一阶段统一规则如下：
* 几何骨架类高阶 action 优先要求精确降解，例如 `line_through_points`、`point_on_segment`、`point_on_line`、`point_on_circle`、`parallel_through_point_to_segment`、`perpendicular_through_point_to_segment`。
* 比例/约束/规则布局类高阶 action 允许“优先精确，必要时近似”，例如 `divide_segment`、`point_by_ratio`、`translate_point`、`equal_length_point`、`regular_polygon`、`constraint_polygon`。
* 当骨架对象无法稳定抽取时，才进入 `clarification` 或 `error`。

## Acceptance Criteria (evolving)

* [ ] 对类似“画一个三角形 ABC，并作它的外接圆”的明确绘图请求，行为不回退。
* [ ] 对类似“正方形 ABCD 内有正八边形 EFGHIJKL，且 E/G/I/K 在四边上”的题干，系统能返回一组可执行 `instructions`，而不是默认 `error`。
* [ ] 返回文本能说明这是“根据题意完成构图”还是“仅完成近似/部分构图”。
* [ ] 在信息不足或命名歧义时，系统优先返回 `clarification`。
* [ ] 当题干约束部分超出当前能力时，系统优先返回可执行构图和说明文本，而不是直接 `error`。
* [ ] 高阶 action 能按统一分层策略被后端降解：骨架类尽量精确，约束类允许近似并带说明。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 第一阶段引入完整几何求解器或自动证明器
* 第一阶段保证所有竞赛题图形都能严格满足全部隐含约束
* 直接根据题干输出最终数值答案

## Technical Notes

* 相关后端文件：`backend/src/main/resources/ai/geometry-workflow.md`、`backend/src/main/java/com/autograph/backend/chat/GeometryLlmClient.java`、`backend/src/main/java/com/autograph/backend/chat/GeometryChatService.java`、`backend/src/main/java/com/autograph/backend/chat/GeometryCapabilityContract.java`
* 当前阻塞点分成两层：
* 第 1 层是分类策略错误。题干一旦带有“求”“边长为”“面积为”等求解措辞，就被 prompt 推到 `error`。
* 第 2 层是表达能力不足。即使允许作图，现有 DSL 对“规则多边形/比例点/精确约束布局”的表达依然偏弱。
* 初步可行方向：
* 已选方向：方向 B。增强 DSL，走“题干转半精确构图”。
* 已确认降级原则：当题干约束超出 DSL 时，优先返回“尽量可执行的近似构图”并明确说明；只有在骨架对象都无法稳定抽取时才进入 `clarification` 或 `error`。
* 已确认能力路线：第一批不是最小增强版，也不是平衡版，而是激进版高阶 action 集。
* 已确认执行架构：高阶 action 在后端统一降解，前端继续只消费基础 action。
* 已确认精度分层：骨架类高阶 action 要求优先精确降解；比例/规则/约束类允许近似降解并在响应文本中披露。

## Decision (ADR-lite)

**Context**: 用户希望系统面对几何题题干时，不要停留在“只能处理明确绘图命令”的层级，但也不希望第一阶段直接升级成完整几何求解器。

**Decision**: 第一阶段采用“题干转半精确构图”路线。系统优先从题干中提取图形对象与约束关系，并通过增强后的高阶绘图原语输出 `instructions`。

**Consequences**:

* 相比纯示意图，图形更接近题意，教学与解题辅助价值更高。
* 相比严格求解器，实现复杂度仍可控。
* 需要扩展 DSL 与校验器，而不只是改 prompt。
* 系统的失败边界会后移，大部分题干会先得到“可画出的骨架图/近似图”，而不是直接拒绝。
* 高阶 action 的解释、求值、近似策略和风险控制集中在后端，前端仍保持稳定的小执行内核。
* 这仍然属于“LLM 决定画什么”，只是后端负责把高阶几何原语翻译成前端可执行的基础原语，不再回到旧的贫弱 intent 架构。
* 第一阶段不会因为少数复杂约束无法严格满足而整体拒绝作图，但系统需要明确披露“精确构图”与“近似构图”的差异。

## Technical Approach

* 输入层面区分“明确绘图请求”和“题干式几何题”，但对外统一返回 `instructions | clarification | error`。
* LLM 对复杂题干输出的是高阶 `instructions`，包含更贴近题意的构图原语。
* 后端新增“高阶 action 降解层”：
* 先做 schema / 引用 / 类型校验
* 再把高阶 action 翻译为基础 action 序列
* 无法精确翻译时，根据策略降级为近似构图并附带说明
* 前端继续只执行基础 action，例如 `place_point`、`segment`、`polygon`、`circle`、`intersection`。
* 精度分层策略：
* 骨架类 action：要求几何关系直接可算、可稳定降解。
* 约束类 action：先尝试精确求值，失败后允许生成近似基础指令，并通过 `responseText` 明示。
