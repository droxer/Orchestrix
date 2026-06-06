---
version: alpha
name: Relay-design-zh-CN
description: Relay 视觉系统采用安静、可信、金融级的品牌语言。基础画布以白色为主，Coinbase Blue (`#0052ff`) 作为唯一强品牌电压，谨慎用于主 CTA、品牌符号和少量内联强调。字体建议使用 CoinbaseDisplay/CoinbaseSans 的替代组合，展示文字保持轻字重，强调编辑感和机构信任，而不是夸张的科技感。
colors:
  primary: "#0052ff"
  primary-active: "#003ecc"
  primary-disabled: "#a8b8cc"
  ink: "#0a0b0d"
  body: "#5b616e"
  body-strong: "#0a0b0d"
  muted: "#7c828a"
  muted-soft: "#a8acb3"
  hairline: "#dee1e6"
  hairline-soft: "#eef0f3"
  canvas: "#ffffff"
  surface-soft: "#f7f7f7"
  surface-card: "#ffffff"
  surface-strong: "#eef0f3"
  surface-dark: "#0a0b0d"
  surface-dark-elevated: "#16181c"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  on-dark-soft: "#a8acb3"
  semantic-up: "#05b169"
  semantic-down: "#cf202f"
  accent-yellow: "#f4b000"
---

# Relay 视觉设计

## 概览

Relay 的营销和产品视觉应呈现“安静可信的机构级平台”，而不是喧闹的 AI 工具或炫技型开发者产品。整体基调接近成熟金融服务品牌：白色画布、克制蓝色、清晰排版、充足留白，以及少量深色 full-bleed hero 承载产品 UI mockup。

核心特征：

- 单一主色：`#0052ff` 只用于主 CTA、品牌符号和少量强调链接。
- 页面以白色、浅灰和近黑色深色段落交替形成节奏。
- 标题字重保持 400，避免过度粗重。
- CTA 使用 pill 形状；卡片保持一致大圆角；图标几何化、克制。
- 深色 hero 中使用浮动产品 UI 卡片，形成品牌最强识别点。
- 数字和表格场景使用等宽字体，提升操作和金融数据感。

## 色彩

### 品牌与强调色

- **Primary Blue (`#0052ff`)**：唯一品牌主色。用于主 CTA、品牌 glyph 和内联强调。
- **Primary Active (`#003ecc`)**：主按钮按下状态。
- **Primary Disabled (`#a8b8cc`)**：禁用状态。
- **Accent Yellow (`#f4b000`)**：少量插图或资产符号点缀，不作为操作色。

### 表面

- **Canvas (`#ffffff`)**：默认页面背景。
- **Surface Soft (`#f7f7f7`)**：轻微分区背景。
- **Surface Strong (`#eef0f3`)**：次级按钮、搜索 pill、图标底板。
- **Surface Dark (`#0a0b0d`)**：深色 hero 和 CTA band。
- **Surface Dark Elevated (`#16181c`)**：深色 hero 中浮动 UI 卡片。

### 文本与边线

- **Ink (`#0a0b0d`)**：标题和强强调。
- **Body (`#5b616e`)**：正文。
- **Muted (`#7c828a`)**：辅助说明、页脚。
- **Hairline (`#dee1e6`)**：默认 1px 分割线。
- **Hairline Soft (`#eef0f3`)**：更轻的分割线。
- **On Dark (`#ffffff`)** 与 **On Dark Soft (`#a8acb3`)**：深色区域文本。

### 语义色

- **Semantic Up (`#05b169`)**：上涨/正向数字，仅作为文字色使用。
- **Semantic Down (`#cf202f`)**：下跌/负向数字，仅作为文字色使用。

## 字体

英文设计稿中的 CoinbaseDisplay、CoinbaseSans、CoinbaseMono 是授权字体。实现时可使用：

- CoinbaseDisplay 替代：Inter，font-weight 400。
- CoinbaseSans 替代：Inter，font-weight 400/600。
- CoinbaseMono 替代：JetBrains Mono、Geist Mono 或系统等宽字体。

原则：

- Hero 和大标题使用轻字重，避免 700+ 的强营销感。
- Display 文本可以有轻微负字距；正文保持 `letter-spacing: 0`。
- 数字、价格、百分比和表格值使用等宽字体。
- 中文字体建议使用系统 sans-serif 栈，保持现代、克制、清晰。

## 布局

- 基础间距单位：4px。
- 常用间距：4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 96px。
- 主要 section 垂直内边距建议 96px。
- 内容最大宽度约 1200px 居中。
- Marketing 页面使用 12 栏 editorial grid。
- Feature grid 常见为桌面端 2-up 或 3-up。
- 密度应留给登录后的工作台和表格，不要把 marketing 页面做成拥挤 dashboard。

## 形状与深度

圆角体系：

| Token | 值 | 用途 |
| --- | --- | --- |
| xs | 4px | 小标签 |
| sm | 8px | 紧凑行 |
| md | 12px | 表单输入 |
| lg | 16px | 中型卡片 |
| xl | 24px | Feature card、mockup card、pricing card |
| pill | 100px | CTA、搜索框、badge |
| full | 9999px | 头像、圆形图标 |

深度原则：

- 80% 表面应保持 flat，不使用装饰阴影。
- 普通卡片可用 1px hairline border。
- hover 阴影保持轻：`0 4px 12px rgba(0, 0, 0, 0.04)`。
- 最重要的视觉深度来自深色 hero 中层叠的产品 UI mockup，而不是泛滥阴影。

## 组件方向

### 顶部导航

白底导航使用 `canvas` 背景和 `ink` 文本，高度约 64px。深色 hero 上的导航使用 `surface-dark` 背景和 `on-dark` 文本。左侧为品牌，右侧为主要导航和 CTA。

### 按钮

- Primary button：蓝色 pill，白字，高 44px，padding 12px 20px。
- Primary hero CTA：更高的蓝色 pill，高 56px，padding 16px 32px。
- Secondary light：浅灰 pill，深色文字。
- Secondary dark：深色 elevated surface，白字。
- Outline on dark：透明 pill，白色描边。
- Tertiary：透明背景，蓝色文字。

### Hero

核心 hero 有两类：

- **Dark hero**：深色 full-bleed，左侧大标题和 CTA，右侧或背景叠加产品 UI mockup。
- **Light hero**：白色画布，适合说明型页面和产品探索页。

Hero 不应只是抽象渐变或装饰图形，必须传达真实产品、工作流或价值场景。

### 卡片

- Product UI card dark：深色 hero 中的浮动产品 UI，使用 `surface-dark-elevated` 和 24px 圆角。
- Product UI card light：白底产品 UI 卡片，1px hairline border。
- Feature card：白底、24px 圆角、32px 内边距。
- Pricing card：白底常规版和深色 featured 版，避免花哨 ribbon。

### 表单与搜索

- Text input：白底、12px 圆角、48px 高，focus 时使用蓝色边框。
- Search input：浅灰 pill，高 44px。
- Badge：浅灰小 pill，适合 section label。

## Do

- 把 `#0052ff` 保留给主 CTA、品牌强调和关键链接。
- CTA 使用 pill，图标容器使用圆形。
- 保持标题轻字重和编辑式节奏。
- 用白色/浅灰/深色 band 形成页面结构。
- 数字信息使用等宽字体。
- 用真实产品 UI mockup 展示能力，而不是纯装饰背景。

## Don't

- 不要把页面做成单一蓝色调或大面积蓝紫渐变。
- 不要使用大量装饰光斑、球体、bokeh、抽象 SVG 作为主体。
- 不要把 marketing 页面做成拥挤 dashboard。
- 不要在卡片中再嵌套大量卡片。
- 不要用高字重标题制造浮夸 AI/Fintech 感。
- 不要使用与品牌无关的插画风格。

## 中文实现建议

中文页面应保持简洁语气，避免堆砌口号。标题可以短而直接，正文解释价值和边界。对于 Relay，最稳定的叙事是：

```text
每一位员工，都被 AI 放大。
```

以及：

```text
Relay 为每位员工提供长期 AI Partner，连接组织知识、业务流程和 Agent 执行能力，让高价值员工把时间用在真正创造价值的工作上。
```
