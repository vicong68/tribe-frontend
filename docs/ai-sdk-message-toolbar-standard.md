# AI SDK 消息工具栏设置标准

## 一、AI SDK 工具栏标准归纳

### 1. 工具栏位置
- **位置**：消息内容下方
- **对齐方式**：
  - 用户消息：工具栏右对齐（`justify-end`）
  - 智能体消息：工具栏左对齐（`justify-start`）

### 2. 工具栏显示规则
- **自动隐藏**：默认隐藏，鼠标悬停到消息区域时显示
- **实现方式**：使用 `opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100`
- **容器类名**：`group/message` 用于触发悬停显示

### 3. 工具栏按钮标准
- **按钮样式**：使用 `Action` 组件（基于 Radix UI Button）
- **按钮尺寸**：`size-9 p-1.5`（36px × 36px）
- **图标尺寸**：16px
- **工具提示**：使用 `Tooltip` 组件，显示中文提示

### 4. 工具栏按钮类型

#### 用户消息工具栏
- **分享**：显示用户列表下拉菜单，选择后转发消息
- **更多操作**（下拉菜单）：
  - 收藏
  - 删除

#### 智能体消息工具栏
- **复制**：复制消息内容到剪贴板
- **编辑**：编辑消息（仅用户消息支持）
- **分享**：显示用户列表下拉菜单，选择后转发消息
- **更多操作**（下拉菜单）：
  - 收藏
  - 删除
- **点赞/点踩**：仅 assistant 消息显示

### 5. 工具栏实现组件
- **容器组件**：`Actions`（`components/elements/actions.tsx`）
- **按钮组件**：`Action`（`components/elements/actions.tsx`）
- **工具栏组件**：`MessageActions`（`components/message-actions.tsx`）

## 二、参考豆包对话框工具栏样式

### 1. 用户消息工具栏
```
[分享] [更多...]
  ↓
  [收藏]
  [删除]
```

### 2. 智能体消息工具栏
```
[复制] [编辑] [分享] [更多...]
  ↓
  [收藏]
  [删除]
```

### 3. 自动隐藏样式
- 所有工具栏图标默认隐藏（`opacity-0`）
- 鼠标悬停到消息区域时显示（`group-hover/message:opacity-100`）
- 使用平滑过渡动画（`transition-opacity`）

## 三、技术实现要点

### 1. 工具栏容器
```tsx
<Actions className={cn(
  isUser ? "justify-end" : "justify-start"
)}>
  {/* 工具栏按钮 */}
</Actions>
```

### 2. 工具栏按钮
```tsx
<Action
  className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100"
  onClick={handleAction}
  tooltip="操作提示"
>
  <Icon />
</Action>
```

### 3. 下拉菜单按钮
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Action
      className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100"
      tooltip="更多操作"
    >
      <MoreIcon />
    </Action>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={handleFavorite}>收藏</DropdownMenuItem>
    <DropdownMenuItem onClick={handleDelete}>删除</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

## 四、新增功能实现

### 1. 分享功能
- **触发**：点击分享图标
- **行为**：显示用户列表下拉菜单（当前可分享的远端用户）
- **选择**：选择用户后，通过 `@xxx` 方式转发消息
- **实现**：调用用户-用户消息发送接口

### 2. 收藏功能
- **触发**：点击收藏图标
- **行为**：将消息添加到收藏夹
- **存储**：后端存储收藏消息，前端实时更新收藏夹列表
- **展示**：收藏夹显示在知识库面板下半部分（收藏/上下文管理区域）

