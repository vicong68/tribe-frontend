"use client";

import type { ComponentProps } from "react";
import { useRightSidebar } from "@/components/right-sidebar-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SidebarLeftIcon } from "./icons";
import { Button } from "./ui/button";

/**
 * 右侧边栏切换按钮
 * 控制知识库面板和对话管理面板的协同展开/折叠
 * - 展开时：对话管理面板向左展开，知识库面板向左滑动
 * - 折叠时：对话管理面板向右折叠，知识库面板向右滑动
 */
export function RightSidebarToggle({
  className,
}: ComponentProps<"button">) {
  const { toggleSidebar, state } = useRightSidebar();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={cn("h-8 px-2 md:h-fit md:px-2", className)}
          data-testid="right-sidebar-toggle-button"
          onClick={toggleSidebar}
          variant="outline"
        >
          <SidebarLeftIcon size={16} className="rotate-180" />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" className="hidden md:block">
        {state === "expanded" ? "折叠右侧面板" : "展开右侧面板"}
      </TooltipContent>
    </Tooltip>
  );
}

