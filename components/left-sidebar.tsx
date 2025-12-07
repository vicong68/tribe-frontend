"use client";

import { cn } from "@/lib/utils";
import { LeftSidebarToggle } from "@/components/sidebar-toggle";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

/**
 * 主面板（最左边的固定侧栏组件）
 * 包含用户面板的展开/折叠按钮
 * 包含用户注销-登录、背景色调整组件（仅显示图标，单击弹出完整内容）
 * 
 * 注意：此组件使用fixed定位，确保始终显示在最左边
 */
export function LeftSidebar() {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);

  // 防止 hydration 不匹配
  useEffect(() => {
    setMounted(true);
  }, []);

  const user = mounted ? session?.user : undefined;

  return (
    <div
      className={cn(
        "fixed left-0 top-0 z-[60] h-screen w-16 shrink-0 flex flex-col",
        "bg-sidebar",
        "transition-all duration-200"
      )}
    >
      {/* 用户面板的展开/折叠按钮 */}
      <div className="flex items-center justify-center pt-4 pb-2">
        <LeftSidebarToggle />
      </div>
      
      {/* 预留总菜单按钮位置 */}
      <div className="flex-1 flex flex-col items-center justify-start">
        {/* 后续可在此添加总菜单按钮 */}
      </div>
      
      {/* 用户注销-登录、背景色调整组件（仅显示图标，单击弹出完整内容） */}
      {/* 显示用户或访客图标 */}
      {/* 使用占位符确保布局稳定，避免 SidebarUserNav 返回 null 时布局跳动 */}
      {/* 服务器端和客户端初始渲染时，都显示占位符，确保 hydration 一致 */}
      <div className="flex items-center justify-center pb-4 min-h-[2.5rem]">
        {mounted && user ? (
          <SidebarUserNav user={user} />
        ) : (
          <div className="h-10 w-10" /> // 占位符，保持布局稳定
        )}
      </div>
    </div>
  );
}

