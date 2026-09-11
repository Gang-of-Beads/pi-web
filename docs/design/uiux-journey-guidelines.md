# UI/UX 判据（journey 修复波用）

来源：CSS-Tricks "When is it OK to Disable Text Selection?"、MDN css-ui、
NN/g Usability Heuristic 5 (Error Prevention)、UX StackExchange、
state-first design (smoothui)、UX Companion 60-point audit。
本文件是 goal mtxdeee9-67v1p2 修复波的判据；每条修复引用这里的条目编号。

## T. 文本可选中性

- T1 可禁选：按钮、工具条、标签页、拖拽把手、徽章、装饰性字形——用户不期望复制的文字。
- T2 永不禁选：正文、消息、错误消息、代码/输出——用户要复制的文字。
- T3 `user-select: none` 会继承给全部后代：只能窄域施加，禁止挂在大容器上。

## E. 错误预防与死状态

- E1（NN/g #5）消除易错条件本身优先于警告：一个永远打不开的会话不该以可点
  行的形态出现在列表里，而不是"点了弹横幅解释"。
- E2 死状态可见但不误导：死会话行保留（absence is not negation），但必须是
  非交互的静置行——无 hover/按压反馈、无按钮语义、无导航。
- E3 错误消息一等公民：写明事实 + 边界，出现在用户当前上下文里；不留无解释
  的死端。
- E4 每个表面设计全部状态：idle / loading / empty / error / partial——跳过
  任何一态的表面是审计 FAIL。

## J. Journey 审计法

- J1 逐表面逐按钮实测（Playwright），每项记录 expect 与 PASS/FAIL。
- J2 每个交互元素必须"看起来可交互"：有边框/背景/阴影之一，且确实可点。
- J3 发现的缺陷按严重度排序，先修 Blocker（如死会话可点入），每项有
  fixed / not-fixed-with-reason / judged-not-true 三态 triage。
