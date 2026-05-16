# brainstorm: llm direct instructions architecture

## Goal

将当前几何聊天链路从“LLM 返回有限 intent，后端再硬编码 compile 成 instructions”调整为“LLM 直接返回受限的绘图 instructions”，提升可表达能力，减少“这也不能画、那也不能画”的上限问题，同时保留足够的校验与澄清机制，避免前端执行错误或不受支持的图形指令。

## What I already know

* 当前前端消费 `POST /api/chat` 的响应时，只要 `data.instructions.length > 0` 就会直接执行 `DrawingEngine.execute(data.instructions)`。
* 当前后端响应模型是 `ChatResponse(status, instructions, responseText, clarification)`，但 LLM 并不直接产出 `instructions`，而是先返回 `GeometryIntent`。
* 当前后端的核心流程是：`GeometryLlmClient.extractIntent()` -> `GeometryChatService.resolveIntent()` -> `GeometryChatService.compile()` -> `GeometryCapabilityContract.validateInstructions()` -> 返回前端。
* 当前架构已经有较完整的歧义澄清能力，例如通过位置、大小、最近对象等描述去解析画布对象，必要时返回 `clarification`。
* 当前前端 `DrawingEngine` 已支持的 action 有：`place_point`、`segment`、`midpoint`、`parallel`、`perpendicular`、`circle`、`circumcircle`、`incircle`、`tangent`、`intersection`、`otherintersection`、`polygon`、`angle`、`bisector`。
* 当前画布上下文由 `ShapeRegistry.serialize()` 提供，已经包含对象顺序、位置、圆心、半径、端点、顶点等信息，可作为 LLM 的上下文输入。
* 当前测试和规范都围绕“intent JSON -> deterministic compile -> instructions”设计，如果改架构，需要同步调整规范、测试和错误矩阵。

## Assumptions (temporary)

* 用户想推翻的是“有限 intent + 后端 compile”这层，而不是放弃后端校验。
* 用户希望 LLM 直接返回的是“受限 DSL / instructions JSON”，不是任意 JSXGraph 代码。
* 对于“模型怎么知道自己画得对不对”，当前更现实的目标不是让模型自证正确，而是建立服务端验证和失败回退机制。

## Open Questions

* 暂无

## Requirements (evolving)

* LLM 可以直接返回前端可执行的 `instructions` 风格结构。
* 后端仍需验证 `action` 是否受支持、参数结构是否完整、引用顺序是否合法。
* 第一阶段采用全直出模式：LLM 直接返回完整 `instructions`，不再对前端暴露 `intent` 模式。
* 对现有画布对象的模糊引用不能静默猜错；歧义场景优先返回 `clarification`，而不是直接执行或简单报错。
* 系统需要一种办法判断 LLM 生成的 instructions 是否“至少结构正确、引用正确、能力边界正确”。
* 新架构应明显放宽能力上限，避免每增加一种图形都必须先加枚举 intent 再写 compile 分支。
* 推荐分流原则是“默认返回 instructions；仅在信息不足或校验失败时返回 clarification/error”。
* 第一阶段后端校验范围定为“结构安全 + 基础几何关系层”，不追求完整几何证明。

## Acceptance Criteria (evolving)

* [ ] `POST /api/chat` 支持一种新的 LLM 输出模式，可直接承载 `instructions`。
* [ ] 后端在执行前能拒绝不支持的 `action`、缺失参数、引用不存在或引用顺序错误的 instructions。
* [ ] 后端在执行前能校验一部分基础几何关系，例如切点在圆上、`polygon` 顶点数量足够、交点/中点输入对象类型合理。
* [ ] 涉及画布已有对象的歧义请求不会静默猜测，并会优先返回 `clarification`。
* [ ] 至少有一组测试能覆盖“LLM 返回 instructions -> 后端验证 -> 前端可执行”的新路径。
* [ ] 第一阶段迁移方案不会破坏当前前端 `DrawingEngine` 契约。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 让 LLM 直接生成任意 JSXGraph 代码
* 在第一阶段引入完整的几何证明器或符号求解器
* 一次性重写前端绘图引擎

## Technical Notes

* 关键后端文件：`backend/src/main/java/com/autograph/backend/chat/GeometryLlmClient.java`、`backend/src/main/java/com/autograph/backend/chat/GeometryChatService.java`、`backend/src/main/java/com/autograph/backend/chat/GeometryCapabilityContract.java`、`backend/src/main/java/com/autograph/backend/chat/ChatModels.java`
* 关键前端文件：`frontend/src/App.jsx`、`frontend/src/lib/DrawingEngine.js`、`frontend/src/lib/ShapeRegistry.js`
* 当前最大的结构性矛盾是：前端契约其实已经是 `instructions`，但 LLM 与后端之间还停留在窄枚举 intent 模式。
* “模型怎么知道自己画得对不对”可拆成三个层级：
  1. 结构正确：JSON schema、action 白名单、params 校验、result_id 唯一性、引用存在性
  2. 语义近似正确：要求 LLM 输出 `responseText` / `plan` / `checks`，并由后端做规则级复核
  3. 几何正确：需要引入几何约束校验或执行后回读验证，这比第一阶段复杂得多
* 当前更自然的外部结果形态其实不是“instructions vs intent”二选一，而是：
  1. `mode: "instructions"`：已能安全执行
  2. `status: "clarification"`：引用或条件不清楚，先问用户
  3. `status: "error"`：不支持、无效、校验失败
  4. `mode: "intent"`：不作为第一阶段的对外返回模式
* 初步可行方案：
  1. 直接模式：LLM 生成完整 instructions，后端做 schema/引用/能力校验；歧义时靠模型主动请求 clarification

## Decision (ADR-lite)

**Context**: 现有 `intent -> compile` 架构能力上限过低，每增加一种绘图能力都需要同步扩展枚举、编译逻辑和测试，已经偏向规则引擎。

**Decision**: 第一阶段改为全直出模式。LLM 直接返回面向前端的 `instructions` 结构；前端不再接收 `intent`；后端负责做执行前校验和失败分流。

**Consequences**:

* 优点：能力扩展更快，更接近“用户一句话 -> 自动作图”的产品目标
* 风险：模型更容易直接产出错误步骤，因此必须补强服务端校验和失败回退
* 迁移影响：`GeometryLlmClient`、`ChatModels`、`GeometryChatService`、测试、后端规范和 prompt 都需要同步调整
* 第一阶段的正确性目标定为“结构安全 + 基础几何关系正确”，不做完整几何求解器
* 歧义处理保留为 `clarification` 路径，这样全直出模式不会退化成静默猜测
