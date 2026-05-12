# brainstorm: Natural Language Geometry Drawing

## Goal

实现一个基于自然语言描述绘制几何图形的功能。用户可以通过与 AI 聊天（右侧 Chatbox）来描述初中数学题目，AI 自动在 JSXGraph 画板（左侧）上绘制对应的几何图形。同时提供基础图形工具栏供手动添加。

## What I already know

* **核心组件**：左侧 JSXGraph 画板，左侧基础图形工具栏，右侧 AI Chatbox。
* **业务逻辑**：主要针对初中数学题目的题意。
* **技术栈**：Vanilla JS (当前 index.html 现状), JSXGraph。
* **交互方式**：自然语言描述 -> AI 绘图；手动选择基础图形 -> 绘图。

## Assumptions (temporary)

* **AI 集成**：AI 将通过某种 API（如 OpenAI/Gemini）处理自然语言并生成 JSXGraph 的绘图指令。
* **画板状态**：绘图是累加的，或者可以根据对话历史进行修改。
* **基础图形**：包括点、线段、射线、直线、圆、多边形等。

## Technical Approach

* **UI 布局**：采用 **方案 C (浮动布局)**。画板铺满全屏，工具栏（左侧或顶部）和 AI 聊天框（右侧）以半透明卡片形式悬浮。
* **AI 交互协议**：采用 **DSL/指令方案 (Option 2)**。AI 将输出结构化的 JSON 指令集，前端通过 `DrawingEngine` 解析并调用 JSXGraph API。
* **状态管理**：前端维护一个 `ShapeRegistry`，记录所有已绘制的图形对象及其依赖关系，方便 AI 进行增量修改。

## Decision (ADR-lite)

**Context**: 需要在 AI 绘图灵活性与系统可控性/安全性之间取得平衡，同时追求极简且沉浸式的交互体验。
**Decision**: 选择结构化 JSON 指令方案 + 全屏浮动 UI 布局。
**Consequences**: UI 设计需要处理好浮动层与画板交互的遮挡关系；DSL 方案能够轻松实现撤销、重做以及 AI 与手动工具栏的同步。

## Implementation Plan

1. **Step 1: UI 重构** - 将 `index.html` 改造为全屏画板，并添加半透明浮动工具栏和聊天框的基础 HTML/CSS 结构。
2. **Step 2: DSL 引擎开发** - 实现 `DrawingEngine` 类，能够解析 JSON 指令并调用 JSXGraph 创建带约束的对象（如 `midpoint`, `parallel`）。
3. **Step 3: 双向同步机制** - 实现 `ShapeRegistry`，监听画板事件并实时序列化状态。
4. **Step 4: AI Mock 与对接** - 编写 Prompt 策略，模拟 AI 返回 JSON 指令进行全链路测试，随后接入实际 API。

## Open Questions

1. **DSL 定义**：MVP 版本需要支持哪些基础几何指令？如何描述几何约束（如“垂直”、“平行”、“中点”）？
2. **布局细节**：左侧工具栏、画板和右侧 Chatbox 的比例分配。
3. **交互闭环**：手动添加的图形如何同步给 AI 的 Context，使其知道画板上已有的元素？

## Requirements (evolving)

* [x] 响应式布局：集成画板、工具栏和聊天框。
* [x] **JSXGraph 指令引擎 (DSL Engine)**：支持点、线、圆以及“中点”、“垂线”、“平行线”等几何约束指令。
* [x] **双向同步机制 (Bidirectional Sync)**：
    *   AI 指令 -> 画板绘图。
    *   手动工具栏操作/图形拖动 -> 更新 `ShapeRegistry` -> AI 可感知当前状态 (已序列化发往后端)。
* [x] **AI 接口对接**：完成 Mock 接口与全栈重构 (Java + React)，确立了 `ChatController` 和通信格式。
* [x] **基础工具栏**：支持常用几何元素的交互式添加，并带有吸附、滑点和撤销功能。

## Acceptance Criteria (evolving)

* [x] 用户输入“作线段 AB 的中点 M”，画板自动计算并标注 M 点。
* [x] 用户手动拖动点 A，与其相关的约束对象（如中点 M、垂线）同步联动。
* [x] 在手动添加一个点 P 后，AI 的 Context 能够接收到 P 的坐标或相对位置 (通过 Backend Context 测试)。
* [x] 界面布局在主流浏览器下显示正常，聊天框与画板交互无卡顿。


## Definition of Done (team quality bar)

* 符合 `.trellis/spec/frontend/` 中的命名和交互规范。
* 代码简洁，关键绘图逻辑有注释。
* 通过手动测试验证 AI 绘图和工具栏绘图的功能闭环。

## Out of Scope (explicit)

* 复杂的几何证明自动推导（当前仅关注绘图）。
* 高级物理模拟或非初中数学范畴的图形。

## Technical Notes

* 当前项目仅有 `index.html`，需要考虑是否拆分文件或在原文件基础上重构。
* JSXGraph 已经通过 CDN 引入。
