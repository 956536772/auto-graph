# brainstorm: 完善AI生成图形功能

## Goal

完善当前“AI 生成图形”能力，使用户可以通过自然语言更稳定地驱动几何绘图，而不是停留在后端关键词匹配的 mock 阶段；同时保持前端现有 JSXGraph 画板与指令执行链路可复用，避免把绘图逻辑散落到 UI 事件里。

## What I already know

* 用户当前目标是“完善 AI 生成图形的功能”，并希望先一起讨论怎么做更好。
* 前端聊天入口位于 `frontend/src/App.jsx`，会把 `text` 和当前画布 `context` 一起发到 `http://localhost:8080/api/chat`。
* 前端已经有一套可执行的绘图指令 DSL：`DrawingEngine` 支持 `place_point`、`segment`、`midpoint`、`perpendicular`、`parallel`、`circle`、`ellipse`、`polygon`、`glider`。
* 前端对象通过 `ShapeRegistry` 管理，当前可序列化的上下文很薄，只包含 `id`、`type`、点坐标和可选标签。
* 后端当前只有 `backend/.../ChatController.java` 一个 mock 控制器，靠 `text.contains(...)` 识别“正方形”“中点”，不具备真实 NL 理解、结构化约束解析、错误恢复或多轮规划能力。
* `.trellis/spec/frontend/` 目前基本还是模板，项目级前端规范尚未沉淀；`.trellis/spec/backend/index.md` 甚至还写着“当前是前端静态站点”，与仓库现状已有偏差。

## Assumptions (temporary)

* 本次要完善的是“自然语言到绘图指令”的产品链路，而不是仅补几个硬编码关键词。
* 可以接受后端继续承担 AI 编排角色，前端主要负责执行指令、展示状态和必要的纠错反馈。
* MVP 不必一开始就覆盖完整几何语法，但至少应当比当前 mock 更通用，并支持基于已有图形上下文继续作图。

## Open Questions

* 暂无阻塞性开放问题；待确认整体需求摘要与实现拆分。

## Requirements (evolving)

* 用户可以通过聊天输入自然语言触发绘图。
* 后端返回结构化绘图指令，前端继续复用 `DrawingEngine.execute(...)` 执行。
* 系统需要利用当前画布上下文，而不是每次都当成空白画布处理。
* MVP 同时覆盖两类场景：
  * 单轮从零作图。
  * 基于当前画布已有对象继续增量构造。
* AI 不直接输出执行级 DSL，而是先输出高层几何意图，再由后端编译成现有 DSL。
* 高层几何意图以命令式构造为主，例如创建点、连线、作中点、作平行线、作垂线、作圆等。
* MVP 的对象引用不只支持显式标签，也支持自然描述引用，例如位置、形状类别、相对关系、最近上下文中的对象指代。
* 当自然描述引用存在歧义、且系统置信度不足时，MVP 应优先进入澄清对话，而不是直接猜测执行。
* MVP 第一版不只覆盖基础作图，还包含一组“高级关系/高级构造”能力。
* 高级关系方向优先面向竞赛题/证明题常见构造，而不是只补通用解析几何参数。
* 竞赛题导向的高级关系，第一阶段优先聚焦“圆与切线”相关构造。
* 圆与切线第一版能力包包括：
  * 过三点作外接圆。
  * 作三角形内切圆。
  * 过圆上一点作切线。
  * 求两圆交点。

## Acceptance Criteria (evolving)

* [x] 明确 MVP 要覆盖的核心使用场景。
* [x] 明确 AI 生成层、指令层、前端执行层各自职责边界。
* [x] 明确至少一种可实施的技术路线，并说明为何比“继续堆关键词匹配”更合适。
* [x] 明确 MVP 的对象引用策略。
* [x] 明确自然描述引用的歧义处理策略。
* [x] 明确 MVP 第一版支持的几何意图集合，尤其是圆与切线子集。
* [ ] 确认整体需求摘要与实现拆分。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 不在本轮讨论里直接实现完整 CAD/GeoGebra 级别的语义系统。
* 不在本轮讨论里承诺一次性覆盖所有几何图元与证明题语义。
* 不先讨论视觉样式微调，重点先放在 AI 生成链路与可维护性。
* 暂不在第一版支持两圆公切线、圆外一点作两条切线、轨迹类构造、几何变换类高级求解。

## Technical Notes

* 已检查文件：
  * `frontend/src/App.jsx`
  * `frontend/src/lib/DrawingEngine.js`
  * `frontend/src/lib/ShapeRegistry.js`
  * `backend/src/main/java/com/autograph/backend/controller/ChatController.java`
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/backend/index.md`
* 当前数据流：`App.handleSendMessage()` -> `POST /api/chat` -> 响应 `instructions[]` -> `DrawingEngine.execute()`
* 当前主要风险：
  * 上下文序列化信息不足，AI 很难稳定引用已有对象关系。
  * 指令层缺少校验/解释层，AI 一旦返回脏数据，前端只能在控制台报错。
  * 后端 API 合约尚未显式建模，未来接真实 LLM 时容易把 prompt、规划、执行耦合进 controller。
* 已确认的范围决策：
  * MVP 不只支持“空白画布起图”，也支持“基于当前图继续构造”。
  * AI 输出高层几何意图，后端负责把意图编译为当前前端可执行 DSL。
  * 高层意图优先采用命令式构造模型。
  * 对象引用不仅支持显式标签，也支持自然描述与上下文指代。
  * 自然描述引用一旦出现低置信度歧义，优先通过对话澄清。
  * MVP 第一版范围包含高级关系，不只停留在基础图元。
  * 高级关系优先按竞赛题导向扩展。
  * 竞赛题高级关系的首个子集，优先选择圆与切线相关构造。
  * 圆与切线的首发能力包为：外接圆、内切圆、过圆上一点作切线、两圆交点。

## Decision (ADR-lite) - Advanced Scope Direction

**Context**: 基础图元和常规构造不足以支撑更像“解题助手”的几何体验；如果要把第一版做得更有辨识度，高级能力需要朝竞赛题常见构造倾斜。

**Decision**: MVP 的高级关系能力优先选择竞赛题导向，而不是优先补解析几何参数化能力。

**Consequences**:

* 优点：产品定位更鲜明，也更符合几何助手场景里的高价值用法。
* 代价：部分能力会超出当前 `DrawingEngine` 直接支持范围，需要扩 DSL 和编译层。

## Decision (ADR-lite) - Advanced Capability Family

**Context**: 竞赛题导向仍然过大，必须继续收敛成第一版能落地的一组能力；在多个方向里，圆与切线兼具辨识度和与现有 `circle` 能力的连续性。

**Decision**: MVP 的高级能力第一阶段优先聚焦“圆与切线”相关构造。

**Consequences**:

* 优点：能在第一版就体现几何助手的高级价值，同时不必立刻引入轨迹/变换那类更重的基础设施。
* 代价：仍需扩展 DSL 和编译器以支持若干复合构造。

## Decision (ADR-lite) - Circle And Tangent MVP Pack

**Context**: 即便锁定在“圆与切线”方向，若继续把公切线、圆外点作双切线等一起纳入，第一版复杂度仍然偏高，需要进一步收窄。

**Decision**: 第一版高级能力包限定为四项：过三点作外接圆、作三角形内切圆、过圆上一点作切线、求两圆交点。

**Consequences**:

* 优点：覆盖典型竞赛题构造，价值足够高，同时仍然能控制工程复杂度。
* 代价：切线和圆系能力暂时不完整，后续还需要第二阶段扩展。

## Technical Approach

后端新增一层高层几何意图 schema，负责承接 LLM 输出；在 schema 之后增加对象解析、歧义判定、语义校验和 DSL 编译四个阶段。前端继续保留 `App -> /api/chat -> DrawingEngine.execute()` 的主链路，但需要补强上下文序列化与错误/澄清消息展示。对于当前 `DrawingEngine` 尚未直接支持的高级构造，需要扩展底层动作或提供由多个底层动作组成的复合编译模板。

建议的高层意图可分三层：

* 基础构造意图：创建点、连接点、作线、作圆、作中点、作平行/垂线等。
* 复合构造意图：circumcircle、incircle、tangent_at_point、circle_intersections。
* 对话控制意图：clarify_reference、clarify_missing_argument、reject_unsupported。

建议的后端流水线：

* `chat request` -> `intent extraction`
* `reference resolution` -> `confidence scoring`
* `clarification or validation`
* `intent compiler` -> `DrawingEngine DSL`
* `response` 返回 `instructions`、`responseText`、可选 `clarification`

## Implementation Plan (small PRs)

* PR1: 定义 API 合约与高层意图 schema，重构 `ChatController` 为可扩展的 pipeline 骨架。
* PR2: 扩展前端上下文序列化与消息协议，支持对象描述、歧义澄清和错误反馈。
* PR3: 实现基础命令式构造意图到现有 DSL 的编译器，并接入显式标签引用。
* PR4: 实现自然描述引用解析、候选排序与低置信度澄清对话。
* PR5: 扩展 `DrawingEngine` / DSL 以支持外接圆、内切圆、过圆上一点作切线、两圆交点。
* PR6: 接入真实 LLM 或可替换的意图生成器，补测试与示例题回归。

## Decision (ADR-lite)

**Context**: 当前前端已经稳定依赖 `DrawingEngine` 执行一个偏底层的绘图 DSL，但自然语言能力需要同时覆盖从零作图和基于上下文的增量构造。

**Decision**: 不让 AI 直接生成执行级 DSL，而是先生成高层几何意图，由后端做语义校验、对象解析和 DSL 编译。

**Consequences**:

* 优点：更适合多轮上下文、错误校验、可扩展新图元和新构造。
* 代价：后端需要新增一层意图 schema、编译器和上下文解析能力，初期实现比“LLM 直接吐 DSL”更重。

## Decision (ADR-lite) - Intent Shape

**Context**: 如果高层意图过度偏向“结果式目标图形”，编译器需要自行拆解大量隐式步骤，不利于先落稳增量构造场景。

**Decision**: MVP 的高层几何意图优先采用命令式构造模型，而不是优先做结果式目标图形拆解。

**Consequences**:

* 优点：与当前 `DrawingEngine` 更贴近，编译器实现更可控，更适合多轮增量作图。
* 代价：像“画一个正方形”这类结果式表达，短期需要有限改写或受能力边界约束。

## Decision (ADR-lite) - Object Referencing

**Context**: 仅支持标签引用虽然实现稳定，但会让多轮几何助手非常机械，不符合真实使用时对“左边那个点”“刚才那条线”这类表达的预期。

**Decision**: MVP 的对象引用除了显式标签外，还支持自然描述引用，包括位置描述、对象类型、相对关系和近期对话上下文中的代称。

**Consequences**:

* 优点：更接近自然几何对话，用户不需要每次都先命名再操作。
* 代价：后端必须建立对象检索与排序机制，并处理歧义、置信度和澄清交互。

## Decision (ADR-lite) - Ambiguity Handling

**Context**: 既然 MVP 已决定支持自然描述引用，歧义是必然出现的；如果系统直接猜测执行，错误会污染后续上下文，尤其在几何构造链路中代价很高。

**Decision**: 当对象解析置信度不足或候选冲突明显时，MVP 优先通过聊天澄清，而不是直接选择一个候选执行。

**Consequences**:

* 优点：能显著降低误作图和上下文连锁错误。
* 代价：对话轮次会增加，且后端需要返回可解释的候选信息与澄清问题。
