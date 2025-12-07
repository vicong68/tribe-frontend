/**
 * 布局配置系统
 * 统一管理布局相关的尺寸、间距等配置
 */

export interface LayoutConfig {
  // 左侧固定栏
  leftSidebarWidth: string;
  
  // 可折叠侧边栏
  sidebarWidth: string;        // 展开宽度
  sidebarWidthIcon: string;    // 折叠宽度
  
  // 内容区域
  contentGap: string;          // 内容区域间距（小图标宽度）
  chatMaxWidth: string;        // 聊天区域最大宽度
  
  // 右侧固定面板
  rightFixedPanelWidth: string; // 占据主区域50%宽度
  rightFixedPanelVisible: boolean;
  
  // 右侧可折叠边栏
  rightSidebarWidth: string;    // 展开宽度
  rightSidebarWidthIcon: string; // 折叠宽度
  rightSidebarVisible: boolean;
}

// 默认配置
export const defaultLayoutConfig: LayoutConfig = {
  leftSidebarWidth: "4rem",           // 64px
  sidebarWidth: "19.2rem",            // 307.2px (16rem * 1.2)
  sidebarWidthIcon: "3rem",           // 48px
  contentGap: "1rem",                 // 16px (小图标宽度)
  chatMaxWidth: "56rem",              // 896px (max-w-4xl)
  rightFixedPanelWidth: "50%",        // 占据主区域50%宽度（动态计算）
  rightFixedPanelVisible: true,       // 默认显示
  rightSidebarWidth: "19.2rem",       // 307.2px (与左侧边栏相同)
  rightSidebarWidthIcon: "3rem",      // 48px
  rightSidebarVisible: true,          // 默认显示
};

/**
 * 计算主内容区域的左边距
 */
export function calculateContentMarginLeft(
  config: LayoutConfig,
  isCollapsed: boolean
): string {
  const { leftSidebarWidth, sidebarWidth, sidebarWidthIcon, contentGap } = config;
  
  const sidebarWidthValue = isCollapsed ? sidebarWidthIcon : sidebarWidth;
  
  return `calc(${leftSidebarWidth} + ${sidebarWidthValue} + ${contentGap})`;
}

/**
 * 获取布局 CSS 变量
 */
export function getLayoutCSSVariables(config: LayoutConfig): Record<string, string> {
  return {
    "--left-sidebar-width": config.leftSidebarWidth,
    "--sidebar-width": config.sidebarWidth,
    "--sidebar-width-icon": config.sidebarWidthIcon,
    "--content-gap": config.contentGap,
    "--chat-max-width": config.chatMaxWidth,
    "--right-fixed-panel-width": config.rightFixedPanelWidth,
    "--right-sidebar-width": config.rightSidebarWidth,
    "--right-sidebar-width-icon": config.rightSidebarWidthIcon,
  };
}

/**
 * 计算右侧固定面板的实际宽度
 * 占据主内容区域的50%
 */
export function calculateRightFixedPanelWidth(
  config: LayoutConfig,
  isLeftCollapsed: boolean
): string {
  const { leftSidebarWidth, sidebarWidth, sidebarWidthIcon, contentGap } = config;
  const leftSidebarWidthValue = isLeftCollapsed ? sidebarWidthIcon : sidebarWidth;
  
  // 主内容区域宽度 = 100vw - 左侧固定栏 - 左侧边栏 - 内容间距
  // 右侧固定面板 = 主内容区域 * 50%
  return `calc((100vw - ${leftSidebarWidth} - ${leftSidebarWidthValue} - ${contentGap}) * 0.5)`;
}

