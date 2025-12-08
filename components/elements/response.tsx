"use client";

import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown> & {
  isStreaming?: boolean;
};

export const Response = memo(
  ({ className, isStreaming = false, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto",
        className
      )}
      // ✅ 优化配置：控制打字机效果速度
      // isAnimating 控制是否启用打字机动画效果
      // 当 isStreaming 为 true 时，启用动画效果，但通过降低前端 throttle 和后端缓冲区来匹配速度
      isAnimating={isStreaming}
      {...props}
    />
  ),
  (prevProps, nextProps) => 
    prevProps.children === nextProps.children && 
    prevProps.isStreaming === nextProps.isStreaming
);

Response.displayName = "Response";
