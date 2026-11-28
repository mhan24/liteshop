---
version: 1
name: liteshop · Signal
description: >
  数字卡密商店的浅色与深色界面。浅色采用雾灰画布与白色卡片，深色采用近黑画布与分层灰面。
  唯一的彩色是「信号青」——只留给主操作、焦点与「有货」信号。
  价格、订单号、卡密一律等宽字体，读起来像终端里的确定数据。
colors:
  # 深色外观。浅色对应值见下方颜色表。
  canvas: "#0B0D0E"          # 页面底色
  sunken: "#08090A"          # 凹陷区：卡密内容、代码块
  surface: "#111416"         # 卡片、面板
  surface-2: "#161A1D"       # 输入框、次级按钮、表头
  surface-3: "#1C2125"       # hover / 选中行
  # 线
  hairline: "#22282C"        # 默认 1px 分隔与卡片边框
  hairline-strong: "#69767B" # 输入框边框、hover 边框
  # 文字
  ink: "#E6E9EA"             # 正文与标题（不用纯白）
  ink-mute: "#959FA5"        # 次要说明
  ink-faint: "#849097"       # 占位符、禁用、元信息
  # 信号色（唯一品牌色）
  signal: "#5EEAD4"
  signal-hover: "#99F6E4"
  on-signal: "#042F2A"       # 信号色上的文字（深色，不用白字）
  # 语义色（只出现在状态徽章、提示条、校验信息里）
  success: "#4ADE80"
  warning: "#FBBF24"
  danger: "#F87171"
  info: "#7DD3FC"
typography:
  sans: 'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
rounded: { sm: 6px, md: 10px, full: 9999px }
spacing: { xs: 4px, sm: 8px, md: 12px, lg: 16px, xl: 24px, xxl: 32px, section: 80px }
---

# liteshop 设计规范（Signal）

本文件是界面的唯一视觉依据：改 UI 前先读它，新增样式先查有没有现成令牌。
颜色令牌统一定义在 `src/app/globals.css`，Tailwind 类名与下表一一对应。
默认跟随系统外观。商城与后台共享手动选择的外观，原生表单和滚动条也跟随当前配色。

## 1. 气质

- **确定、安静、可信。** 买家在这里付加密货币换卡密，界面要像一台运转正常的机器：
  信息直给，状态明确，没有营销式的喧闹。
- **表面分层。** 两种外观均用表面明度（canvas → surface → surface-2 → surface-3）和 1px 发丝线区分层级。
- **一个信号色。** 信号青只用于：主按钮、焦点环、链接 hover、「有货」指示点、选中态。
  页面上任何彩色若不是状态语义，就只能是信号青。
- **数据用等宽。** 价格、订单号、查单密码、库存数、卡密内容、时间戳一律 `font-mono`
  + `tabular-nums`，与说明文字形成「数据 vs 叙述」两种质感。

## 2. 颜色与角色

| 令牌（Tailwind） | 浅色 | 深色 | 角色 |
|---|---|---|---|
| `bg` | #F6F8F7 | #0B0D0E | 页面画布 |
| `sunken` | #E6ECE9 | #08090A | 卡密、代码与查单密码展示 |
| `surface` | #FFFFFF | #111416 | 卡片、面板、表格容器 |
| `surface-2` | #EDF2F0 | #161A1D | 输入框、次级按钮、表头、标签底 |
| `surface-3` | #E1E9E6 | #1C2125 | 悬停、选中行、按下态 |
| `line` | #CBD6D1 | #22282C | 默认分隔线与卡片边框 |
| `line-strong` | #738780 | #69767B | 输入框边框、卡片悬停边框 |
| `fg` | #172723 | #E6E9EA | 主文字 |
| `muted` | #435550 | #959FA5 | 次要文字 |
| `faint` | #55655F | #849097 | 占位符、元信息、眉题 |
| `accent` | #00695D | #5EEAD4 | 主操作与焦点 |
| `accent-hover` | #00564B | #99F6E4 | 主按钮悬停 |
| `accent-fg` | #FFFFFF | #042F2A | 主按钮文字 |
| `tint-green / -fg` | #E2F3E8 / #13633B | 绿 10% 底 / #86EFAC | 成功、已完成 |
| `tint-yellow / -fg` | #FCF1D8 / #795108 | 黄 10% 底 / #FCD34D | 待处理、警示 |
| `tint-red / -fg` | #FBE9E9 / #93232C | 红 10% 底 / #FCA5A5 | 错误、危险操作、缺货 |
| `tint-blue / -fg` | #E5F1FA / #155785 | 蓝 10% 底 / #7DD3FC | 进行中、提示 |

正文、提示文字和状态标签文字在相应背景上的对比度至少为 4.5:1，输入框边框与相邻表面至少为 3:1。

## 3. 字体

不加载网络字体（国内访问稳定、无 CSP 例外）。中文走系统黑体，数据走系统等宽。

| 层级 | 尺寸 / 字重 / 行高 / 字距 | 用途 |
|---|---|---|
| display | 40px(移动 32) / 600 / 1.1 / -0.02em | 首页主标题，全站仅一处 |
| h1 | 28px / 600 / 1.2 / -0.015em | 页面标题 |
| h2 | 18px / 600 / 1.35 / -0.01em | 区块标题 |
| h3 | 15px / 600 / 1.4 | 卡片标题 |
| body | 15px / 400 / 1.7 | 正文 |
| small | 13px / 400 / 1.6 | 说明、表格 |
| eyebrow | 11px / 500 / mono / 大写 / 0.14em | 区块眉题，如 `// 全部商品` |
| data | 等宽 + tabular-nums，随所在层级 | 价格、订单号、库存、卡密 |

规则：标题字重不超过 600；不用衬线体；不用斜体。

## 4. 组件

**按钮**（高 40px，移动端主按钮 44px；圆角 `sm`；无阴影；按下 `scale(0.98)`）
- `default` 主按钮：`accent` 底 + `accent-fg` 字；hover `accent-hover`。**每个视图区最多一个。**
- `outline` 次级：`surface-2` 底 + `line-strong` 边 + `fg` 字；hover `surface-3`。
- `ghost`：透明 + `muted` 字；hover `surface-2` 底 + `fg` 字。
- `danger`：`tint-red` 底 + `tint-red-fg/30` 边 + `tint-red-fg` 字（深色界面上不用大红实底）。
- 禁用：50% 不透明度，不响应指针。

**输入框**：高 40px，`surface-2` 底，`line-strong` 边，圆角 `sm`；占位符 `faint`；
focus：边框 `accent` + 3px `accent/20` 外环；错误：边框 `tint-red-fg`。

**卡片**：`surface` 底 + `line` 边 + 圆角 `md`；内边距 24px（移动 20px）。
可点击卡片 hover：边框 `line-strong` + 底 `surface-2`，不位移、不加阴影。

**徽章 / 状态**：全圆角，11–12px，`tint-*` 底 + 同系 `-fg` 字 + 同系 25% 边框；
可带 6px 圆点前缀表示「活」状态（有货、待支付）。

**筛选标签（chip）**：高 32px，全圆角，`line` 边，`muted` 字；
选中：`accent/10` 底 + `accent/40` 边 + `accent` 字。

**数据块（sunken）**：`sunken` 底 + `line` 边 + 圆角 `sm` + 等宽字，用于卡密、查单密码；
附「复制」幽灵按钮。

**导航**：粘顶，`bg/80` + 背景模糊 + 底部 `line`；左侧站名（等宽方块标记 + 名称），
右侧文字链接 `muted`，hover `fg`；购物车数量用信号青小徽标。

**表格（后台）**：`surface` 容器，表头 `surface-2` + `faint` 眉题字，行分隔 `line`，
行 hover `surface-3`；数字列右对齐、等宽。

## 5. 布局

- 容器：商城 `max-w-6xl`（1152px），阅读型页面（结算、支付、查单）`max-w-xl`。
- 8px 基准；区块间距 80px（移动 56px）；卡片网格间距 16px。
- 首页：主视觉 → 商品网格（1 / 2 / 3 列）→ 流程 → 常见问题。
- 背景装饰仅允许一处：首页主视觉顶部极淡的信号青径向光（≤ 8% 不透明度）+ 细网格纹理。

## 6. 层级

| 层 | 处理 | 用途 |
|---|---|---|
| 0 | `bg` | 画布 |
| 1 | `surface` + `line` | 卡片、面板 |
| 2 | `surface-2` + `line-strong` | 输入、悬停卡片、表头 |
| 3 | `surface-3` | 选中、按下 |
| 焦点 | `accent` 2px 轮廓 / 3px 外环 | 键盘焦点，全站一致 |

## 7. 该做 / 不该做

**该做**
- 价格、订单号、卡密用等宽 + tabular-nums。
- 状态一律用徽章色；正文永远是 `fg` / `muted`。
- 主操作用信号青实底按钮，次操作用 outline。
- 危险操作用红色淡底，并写清后果（「取消后卡密退回库存，订单不可恢复」）。
- 尊重 `prefers-reduced-motion`；动效 ≤ 200ms（入场除外，≤ 600ms）。

**不该做**
- 不用纯黑 #000 画布、不用纯白 #FFF 大段文字。
- 不用阴影、渐变按钮、霓虹发光文字、多彩装饰。
- 不在一个视图里放两个信号青实底按钮。
- 不用衬线体、斜体、超过 600 的字重。
- 不把信号青用于状态（成功用绿，不用信号青）。

## 8. 响应式

| 断点 | 宽度 | 变化 |
|---|---|---|
| 移动 | < 640px | 单列；主标题 32px；主按钮通栏 44px 高；导航压缩为图标 + 短词 |
| 平板 | 640–1023px | 商品 2 列 |
| 桌面 | ≥ 1024px | 商品 3 列；商品详情左右分栏 |

触控目标 ≥ 40px；表格在移动端横向滚动，不折叠列。

## 9. 给 AI 的提示

- 改 UI 前读本文件；只用 `globals.css` 里的令牌类名，不写十六进制颜色。
- 新页面骨架：`eyebrow`（等宽眉题）→ `h1` → 一句 `muted` 说明 → 内容卡片。
- 一个视图一个主按钮；其余 outline / ghost。
- 数据（钱、号、码、量、时间）→ `font-mono tabular-nums`。
- 状态 → `Badge tone`，不要自己拼颜色。
