"use client";

import type { User } from "next-auth";
import { ConversationPanel } from "@/components/conversation-panel";

/**
 * 右侧对话管理面板（新实现）
 * 使用全新的 ConversationPanel 组件，确保所有属性都能正确生效
 * 
 * 原实现（已废弃，保留作为参考）：
 * - 使用 Sidebar 组件，但属性调整无法生效
 * - 依赖 SidebarProvider 的配置，导致宽度和位置控制不够灵活
 * 
 * 新实现：
 * - 使用独立的 ConversationPanel 组件
 * - 直接控制宽度、位置和动画，确保所有属性都能正确生效
 * - 固定宽度 12rem，offcanvas 模式，与知识库面板联动
 */
export function RightSidebar({ user }: { user: User | undefined }) {
  return <ConversationPanel user={user} />;
}

/* ========== 原实现（已废弃，保留作为参考） ========== */
/*
"use client";

import type { User } from "next-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { SidebarHistory } from "@/components/sidebar-history";
import { useRightSidebar } from "@/components/right-sidebar-provider";

export function RightSidebar_OLD({ user }: { user: User | undefined }) {
  const { state } = useRightSidebar();

  return (
    <Sidebar 
      side="right" 
      collapsible="offcanvas"
      className="border-l-0"
    >
      <SidebarHeader>
        <SidebarMenu>
          <div className="px-2 py-1 text-sm font-semibold text-sidebar-foreground">
            对话管理
          </div>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarHistory user={user} />
      </SidebarContent>
    </Sidebar>
  );
}
*/

