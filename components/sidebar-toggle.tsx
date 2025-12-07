import type { ComponentProps } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SidebarLeftIcon } from "./icons";
import { Button } from "./ui/button";

/**
 * 左侧边栏切换按钮
 * 专门用于控制用户面板（左侧可折叠边栏）的展开/折叠
 */
export function LeftSidebarToggle({
  className,
}: ComponentProps<"button">) {
  const { toggleSidebar, state } = useSidebar();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={cn("h-8 px-2 md:h-fit md:px-2", className)}
          data-testid="left-sidebar-toggle-button"
          onClick={toggleSidebar}
          variant="outline"
        >
          <SidebarLeftIcon size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="start" className="hidden md:block">
        {state === "expanded" ? "折叠左侧面板" : "展开左侧面板"}
      </TooltipContent>
    </Tooltip>
  );
}

// 保持向后兼容，但标记为已弃用
/** @deprecated 使用 LeftSidebarToggle 代替 */
export const SidebarToggle = LeftSidebarToggle;
