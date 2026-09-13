# UI 协调性修复交付（goal mty82jcc-0zf38k · task-6 机主核对单）

全部已部署 8505（供包 `index-DbUthyTQ.js` 字节核对含全部修复）。手机刷新后逐项核对：

## 1. Goals 徽章语义（"这个1是干嘛的"）
- `a8997198`：徽章带 title/aria "Goals: N open"——数字 = 该 goal 剩余任务数
- 核对：悬停 Goals chip 显示说明

## 2. 手机密度（"老年机"）
- `45526bde`：行高 56→44（触摸下限保持）、消息节奏 16→10、磁贴路径单行
- `7f94b08e`：手机字号整档下调（base 13px，meta 12px 下限保持）
- 核对：/tmp/journeys/final-1-compact-projects.png——一屏项目数 12→14

## 3. 悬浮缝隙/断字浮字
- `75a57edb`：聊天顶边渐隐 mask（切断文字 → 渐隐淡出）
- `695e5c1e` + `38df6176`：meter 不透明带 + 退到抽屉边线之下
- 核对：滚动聊天至顶部，无拦腰断字、无裸文字渗出

## 4. 面板等宽（"宽窄不一"）
- `e6767f86`：左右面板统一 340px（原右面板 32vw 在桌面宽出约 100px）
- 核对：桌面双栏等宽

## 5. Change context → Where am I working?
- `34c6f7b1`：sheet 标题与 label 改为任务语义
- 核对：点 context chip 弹出的标题

## 6. 工具面板标题栏统一
- `fa734b73`：Files/Tasks/Relays 三种节奏 → 一套 token（同 padding + 同头高）

## 7. 死工作区全家福
- `875ccc92`/`60884159`/`5722eec7`/`09a750e0`/`2d708135`：
  死行静置 + 徽章在 meta 行首对齐（x=23 全行一致）+ 菜单无 History +
  start 按钮禁用 + 诚实空态 + cleanup 一键归档死会话
- 核对：/tmp/journeys/final-2-dead-rows-aligned.png（opus-a 全部死会话，
  徽章 x=23 对齐）；final-3-cleanup-auto-preview.png（Run enabled=true）

## 8. 永久报错 → 重试闭环（"不允许任何永久的报错"）
- `fb83cf2e`：5xx/网络错误自动重试 4 次退避，横幅显示 "— retrying…"，
  成功即清；4xx 保留原信息
- 核对：下次 5xx 时横幅带 retrying 字样并自行恢复

## 9. Clean up 自动预览（"根本不能 clean up"）
- `7f94b08e`：打开即预览、改勾选即重预览——Run 在预览落地后立即可用
- 核对：final-3 截图（未点 Preview，Run 已 enabled）
