"use client";

import type { User } from "next-auth";
import { useRightSidebar } from "@/components/right-sidebar-provider";
import { SidebarHistory } from "@/components/sidebar-history";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

/**
 * 对话管理面板（全新实现）
 * 
 * 需求：
 * 1. 宽度：固定值 12rem（192px），确保对话管理内容正常显示
 * 2. 位置：固定在页面右侧，使用 offcanvas 模式
 *    - 展开时：right: 0（对齐页面最右端）
 *    - 收缩时：right: -12rem（完全隐藏到页面右侧外）
 * 3. 联动模式：与知识库面板协同随动
 *    - 收缩时：完全隐藏，仅暴露知识库面板
 *    - 展开时：两个面板同时向左移动，移动距离 = 对话管理面板宽度
 * 4. 动画：200ms ease-linear，与知识库面板一致
 * 
 * 注意：这是全新的实现，不依赖 Sidebar 组件，确保所有属性都能正确生效
 */
export function ConversationPanel({ user }: { user: User | undefined }) {
  const { state } = useRightSidebar();
  const [mounted, setMounted] = useState(false);

  // 确保客户端挂载后再渲染，避免 hydration 问题
  useEffect(() => {
    setMounted(true);
  }, []);

  // 对话管理面板宽度：固定值 9rem（刚好适配三个图标：新对话+对话状态设置下拉+删除所有对话，确保删除图标完整显示）
  // 注意：这个宽度必须与 RightFixedPanel 中的宽度一致，确保知识库面板的左移距离正确
  const PANEL_WIDTH = "9rem";

  // 设置 CSS 变量供其他组件使用
  // 注意：必须在 mounted 后立即设置，确保 RightFixedPanel 能正确读取
  useEffect(() => {
    if (mounted) {
      // 立即设置 CSS 变量，确保其他组件能正确读取
      document.documentElement.style.setProperty("--right-conversation-panel-width", PANEL_WIDTH);
      document.documentElement.style.setProperty("--right-sidebar-state", state);
    }
  }, [mounted, state, PANEL_WIDTH]);

  if (!mounted) {
    return null;
  }

  const isExpanded = state === "expanded";

  return (
    <div
      className={cn(
        "fixed inset-y-0 z-10 h-screen",
        "bg-sidebar",
        "transition-all duration-200 ease-linear",
        "hidden md:block"
      )}
      style={{
        width: PANEL_WIDTH,
        // 展开时：right: 0（对齐页面最右端）
        // 收缩时：right: -9rem（完全隐藏到页面右侧外）
        right: isExpanded ? "0" : `-${PANEL_WIDTH}`,
      } as React.CSSProperties}
    >
      <div className="flex h-full w-full flex-col">
        {/* 面板头部 */}
        <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-2 pt-4">
          <div className="px-2 py-1 text-sm font-semibold text-sidebar-foreground">
            对话管理
          </div>
        </div>

        {/* 面板内容 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <SidebarHistory user={user} />
        </div>
      </div>
    </div>
  );
}

