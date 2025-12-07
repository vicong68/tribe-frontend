# 前端框架标准规范

## 一、设计原则

### 1. 功能模块分区
- **左侧固定栏**：主菜单、全局导航（固定宽度：4rem）
- **左侧可折叠栏**：用户信息、好友列表、对话历史（可展开/折叠）
- **中央内容区**：主要功能区域（聊天、知识库等）
- **右侧扩展区**：知识库、收藏、上下文等（预留空间）

### 2. 局部配置化
- 使用 CSS 变量统一管理尺寸、间距、颜色
- 组件通过 props 接收配置，支持局部定制
- 布局系统支持动态调整，快速响应需求变化

### 3. 标准化与优化
- 遵循 Shadcn/ui + Tailwind CSS 设计系统
- 响应式设计，适配移动端和桌面端
- 性能优化：懒加载、代码分割、状态管理

## 二、布局系统架构

### 1. 布局层级
```
SidebarProvider (根容器)
├── LeftSidebar (固定左侧栏，4rem)
├── AppSidebar (可折叠侧边栏，19.2rem/3rem)
└── MainContentArea (主内容区)
    ├── ChatArea (聊天区域，左对齐)
    └── RightPanel (右侧面板，预留)
```

### 2. CSS 变量系统
```css
--left-sidebar-width: 4rem;           /* 左侧固定栏 */
--sidebar-width: 19.2rem;             /* 侧边栏展开宽度 */
--sidebar-width-icon: 3rem;           /* 侧边栏折叠宽度 */
--content-gap: 1rem;                  /* 内容区域间距 */
--chat-max-width: 56rem;              /* 聊天区域最大宽度 */
```

### 3. 响应式断点
- 移动端：< 768px（侧边栏变为抽屉）
- 桌面端：≥ 768px（侧边栏固定显示）

## 三、组件设计规范

### 1. 布局组件
- **LayoutContainer**: 主布局容器，管理整体结构
- **ContentArea**: 内容区域，支持左右分区
- **Panel**: 面板组件，可配置宽度、位置、显示/隐藏

### 2. 配置化接口
```typescript
interface LayoutConfig {
  leftSidebarWidth: string;
  sidebarWidth: string;
  sidebarWidthIcon: string;
  contentGap: string;
  chatMaxWidth: string;
  rightPanelWidth?: string;
  rightPanelVisible?: boolean;
}
```

### 3. 状态管理
- 使用 React Context 管理布局状态
- 支持持久化（localStorage/cookies）
- 支持动态调整，实时响应

## 四、实施步骤

### 阶段一：基础布局系统
1. 创建布局配置系统
2. 实现 CSS 变量管理
3. 优化 SidebarInset 定位

### 阶段二：功能区域分区
1. 聊天区域左移配置
2. 右侧面板预留空间
3. 响应式适配

### 阶段三：扩展与优化
1. 知识库区域集成
2. 收藏与上下文区域
3. 性能优化与用户体验提升

