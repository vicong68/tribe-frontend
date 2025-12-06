# 前端独有功能使用指南

本文档介绍前端独有功能的使用方式，包括 Artifact 功能、工具调用和消息投票功能。

## 1. Artifact 功能（代码/文档编辑）

### 功能概述

Artifact 是一个特殊的用户界面模式，用于帮助用户进行写作、编辑和其他内容创建任务。当 Artifact 打开时，它显示在屏幕右侧，而对话显示在左侧。创建或更新文档时，更改会实时反映在 Artifact 中并可见。

### 支持的 Artifact 类型

- **text** - 文本文档（Markdown 支持）
- **code** - 代码片段（Python 等）
- **sheet** - 电子表格（CSV 格式）
- **image** - 图片编辑

### 使用方法

#### 创建文档

在聊天中输入以下类型的请求：

\`\`\`
用户: "帮我写一篇关于硅谷的文章"
用户: "写一个 Python 函数计算斐波那契数列"
用户: "创建一个包含销售数据的电子表格"
\`\`\`

AI 会自动调用 `createDocument` 工具，在右侧打开 Artifact 面板显示生成的文档。

#### 更新文档

文档创建后，可以通过以下方式更新：

\`\`\`
用户: "优化这篇文章的段落结构"
用户: "修改代码，添加错误处理"
用户: "在电子表格中添加一列"
\`\`\`

AI 会调用 `updateDocument` 工具，实时更新右侧的文档内容。

### 技术实现

- **工具定义**: `lib/ai/tools/create-document.ts` 和 `lib/ai/tools/update-document.ts`
- **组件**: `components/artifact.tsx`
- **编辑器**:
  - 文本: `components/text-editor.tsx`
  - 代码: `components/code-editor.tsx`
  - 电子表格: `components/sheet-editor.tsx`
  - 图片: `components/image-editor.tsx`

### 触发条件

根据 `lib/ai/prompts.ts` 中的 `artifactsPrompt`：

**何时使用 `createDocument`**:
- 内容超过 10 行或代码
- 用户可能保存/重用的内容（邮件、代码、文章等）
- 明确要求创建文档
- 内容包含单个代码片段

**何时不使用 `createDocument`**:
- 信息性/解释性内容
- 对话式回复
- 用户要求保持在聊天中

**何时使用 `updateDocument`**:
- 重大更改时默认完整重写文档
- 仅针对特定、孤立的更改使用定向更新
- 遵循用户指示修改哪些部分

**何时不使用 `updateDocument`**:
- 创建文档后立即更新（等待用户反馈）

### API 端点

- `GET /api/document?id={documentId}` - 获取文档
- `POST /api/document?id={documentId}` - 更新文档
- `DELETE /api/document?id={documentId}` - 删除文档

---

## 2. 工具调用（天气、文档）

### 功能概述

前端支持多种工具调用，允许 AI 执行特定任务并返回结构化结果。

### 可用工具

#### 2.1 天气查询工具 (`getWeather`)

**功能**: 获取指定位置的当前天气信息

**使用方法**:

\`\`\`
用户: "旧金山的天气怎么样？"
用户: "北京现在的温度是多少？"
用户: "查询坐标 37.7749, -122.4194 的天气"
\`\`\`

**工具定义**: `lib/ai/tools/get-weather.ts`

**参数**:
- `city` (可选): 城市名称（如 "San Francisco", "New York", "London"）
- `latitude` (可选): 纬度
- `longitude` (可选): 经度

**返回数据**:
- 当前温度
- 每小时温度预测
- 日出/日落时间
- 时区信息

**显示组件**: `components/weather.tsx`

**数据源**: 
- 地理编码: `https://geocoding-api.open-meteo.com/v1/search`
- 天气数据: `https://api.open-meteo.com/v1/forecast`

#### 2.2 文档创建工具 (`createDocument`)

见上述 Artifact 功能部分。

#### 2.3 文档更新工具 (`updateDocument`)

见上述 Artifact 功能部分。

#### 2.4 建议请求工具 (`requestSuggestions`)

**功能**: 请求 AI 提供后续操作建议

**使用方法**: 通常在对话中自动触发，AI 会在适当时候提供建议操作。

### 工具调用流程

1. **用户发送消息** → 前端发送到 `/api/chat`
2. **AI 处理消息** → 判断是否需要调用工具
3. **工具执行** → 调用相应的工具函数
4. **结果返回** → 在消息中显示工具调用结果
5. **UI 渲染** → 使用专门的组件显示结果（如 Weather 组件）

### 工具调用显示

工具调用在消息中显示为可折叠的工具卡片：

- **工具输入**: 显示传递给工具的参数
- **工具输出**: 显示工具返回的结果
- **状态**: `input-available`（输入可用）或 `output-available`（输出可用）

### 技术实现

- **工具注册**: `app/(chat)/api/chat/route.ts` 中的 `tools` 对象
- **工具定义**: `lib/ai/tools/` 目录
- **UI 组件**: `components/message.tsx` 中的工具渲染逻辑

---

## 3. 消息投票功能

### 功能概述

用户可以对 AI 的回复进行投票（点赞/点踩），用于反馈回复质量。

### 使用方法

#### 投票操作

1. **点赞（Upvote）**:
   - 将鼠标悬停在 AI 回复消息上
   - 点击消息右侧的 👍 图标
   - 或使用快捷键（如果有）

2. **点踩（Downvote）**:
   - 将鼠标悬停在 AI 回复消息上
   - 点击消息右侧的 👎 图标

#### 投票状态

- **未投票**: 两个按钮都可用
- **已点赞**: 点赞按钮禁用（灰色），点踩按钮可用
- **已点踩**: 点踩按钮禁用（灰色），点赞按钮可用
- **切换投票**: 可以点击另一个按钮切换投票状态

### 技术实现

#### 前端组件

- **消息操作**: `components/message-actions.tsx`
- **投票按钮**: 集成在消息操作栏中

#### API 端点

- `GET /api/vote?chatId={chatId}` - 获取聊天的所有投票
- `PATCH /api/vote` - 创建或更新投票

**请求体**:
\`\`\`json
{
  "chatId": "uuid",
  "messageId": "uuid",
  "type": "up" | "down"
}
\`\`\`

#### 数据库

- **表**: `Vote_v2`
- **字段**:
  - `chatId`: 聊天 ID
  - `messageId`: 消息 ID
  - `isUpvoted`: 是否点赞（true = 点赞, false = 点踩）

#### 权限控制

- 只有聊天所有者可以投票
- 需要登录用户身份验证

### 投票数据流

1. **用户点击投票按钮** → 前端发送 PATCH 请求
2. **后端验证权限** → 检查用户是否为聊天所有者
3. **更新数据库** → 创建或更新投票记录
4. **更新 UI** → 使用 SWR 乐观更新本地状态
5. **显示反馈** → Toast 通知投票成功/失败

### 使用场景

- **反馈回复质量**: 帮助改进 AI 回复
- **训练数据收集**: 可用于模型微调（未来功能）
- **用户体验**: 提供简单的反馈机制

---

## 功能集成示例

### 完整对话流程示例

\`\`\`
用户: "帮我写一个 Python 函数计算阶乘，然后查询北京的天气"

AI: 
1. 调用 createDocument 工具 → 创建代码 Artifact
2. 在右侧显示代码编辑器，实时显示生成的代码
3. 调用 getWeather 工具 → 查询北京天气
4. 在消息中显示天气卡片，包含温度、日出日落等信息
5. 用户可以对回复进行点赞/点踩
\`\`\`

### 代码示例

#### 创建文档请求

\`\`\`typescript
// 用户消息
{
  role: "user",
  parts: [
    {
      type: "text",
      text: "写一篇关于人工智能的文章"
    }
  ]
}

// AI 工具调用
{
  type: "tool-call",
  toolName: "createDocument",
  args: {
    title: "关于人工智能的文章",
    kind: "text"
  }
}

// 工具结果
{
  type: "tool-result",
  toolCallId: "call_123",
  output: {
    id: "doc-uuid",
    title: "关于人工智能的文章",
    kind: "text",
    content: "文档已创建并显示给用户"
  }
}
\`\`\`

#### 天气查询请求

\`\`\`typescript
// 用户消息
{
  role: "user",
  parts: [
    {
      type: "text",
      text: "旧金山的天气怎么样？"
    }
  ]
}

// AI 工具调用
{
  type: "tool-call",
  toolName: "getWeather",
  args: {
    city: "San Francisco"
  }
}

// 工具结果
{
  type: "tool-result",
  toolCallId: "call_456",
  output: {
    cityName: "San Francisco",
    current: {
      temperature_2m: 17.5
    },
    // ... 更多天气数据
  }
}
\`\`\`

#### 投票操作

\`\`\`typescript
// 前端发送投票请求
fetch("/api/vote", {
  method: "PATCH",
  body: JSON.stringify({
    chatId: "chat-uuid",
    messageId: "message-uuid",
    type: "up" // 或 "down"
  })
})
\`\`\`

---

## 配置和自定义

### 启用/禁用工具

在 `app/(chat)/api/chat/route.ts` 中配置 `experimental_activeTools`:

\`\`\`typescript
experimental_activeTools: [
  "getWeather",
  "createDocument",
  "updateDocument",
  "requestSuggestions",
]
\`\`\`

### 自定义 Artifact 类型

1. 在 `lib/artifacts/server.ts` 中注册新的文档处理器
2. 在 `components/artifact.tsx` 中添加对应的编辑器组件
3. 在 `artifactDefinitions` 数组中添加新的 Artifact 定义

### 自定义工具

1. 在 `lib/ai/tools/` 目录创建新的工具文件
2. 使用 `tool()` 函数定义工具
3. 在 `app/(chat)/api/chat/route.ts` 中注册工具
4. 在 `components/message.tsx` 中添加工具结果的渲染逻辑

---

## 注意事项

1. **Artifact 功能**:
   - 文档内容会自动保存（2秒防抖）
   - 支持版本历史（可通过版本选择器查看）
   - 文档与聊天消息关联

2. **工具调用**:
   - 工具调用是异步的
   - 工具结果会实时流式显示
   - 某些工具可能需要外部 API 访问

3. **投票功能**:
   - 每个消息只能有一个投票状态
   - 投票是持久的（保存在数据库中）
   - 只有聊天所有者可以投票

---

## 相关文件

- **Artifact**: 
  - `components/artifact.tsx`
  - `lib/ai/tools/create-document.ts`
  - `lib/ai/tools/update-document.ts`
  - `artifacts/` 目录

- **工具调用**:
  - `lib/ai/tools/get-weather.ts`
  - `components/weather.tsx`
  - `components/message.tsx`

- **投票**:
  - `components/message-actions.tsx`
  - `app/(chat)/api/vote/route.ts`
  - `lib/db/queries.ts` (voteMessage 函数)
