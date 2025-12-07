"use client";

import { ChevronUp, User as UserIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { guestRegex } from "@/lib/constants";
import { getBackendMemberId, updateBackendOnlineStatus } from "@/lib/user-utils";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";
import { cn } from "@/lib/utils";
import { UnifiedAvatar } from "./unified-avatar";

export function SidebarUserNav({ user }: { user: User }) {
  const router = useRouter();
  const { data, status } = useSession();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // 防止 hydration 不匹配
  useEffect(() => {
    setMounted(true);
  }, []);

  // 在服务器端和客户端初始渲染时，都使用相同的占位符，避免 hydration 不匹配
  // 服务器端渲染时，mounted 为 false，返回一个简单的占位符
  // 客户端首次渲染时，mounted 仍为 false，保持与服务器端一致
  // 客户端 hydration 完成后，mounted 变为 true，再渲染完整组件
  const isGuest = mounted && data?.user?.email ? guestRegex.test(data.user.email) : false;
  const isLoading = !mounted || status === "loading";

  // 服务器端和客户端初始渲染时，返回 null，避免 hydration 不匹配
  // 客户端挂载后，再渲染完整组件
  // 这样可以确保服务器端和客户端初始渲染完全一致（都是 null）
  if (!mounted) {
    return null;
  }

  // 客户端挂载后，渲染完整的组件
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-10 w-10 rounded-full",
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              )}
              data-testid="user-nav-button"
            >
              {isLoading ? (
                <div className="size-6 animate-pulse rounded-full bg-zinc-500/30" />
              ) : !isGuest && user ? (
                <UnifiedAvatar
                  name={user.name || user.email || "用户"}
                  id={getBackendMemberId(user)}
                  isAgent={false}
                  size={8}
                />
              ) : (
                <UserIcon className="h-5 w-5" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          {isLoading ? (
            "加载中..."
          ) : isGuest ? (
            "访客"
          ) : (
            user?.email || "用户"
          )}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-56 z-[70]"
        data-testid="user-nav-menu"
        side="right"
        align="end"
      >
        {/* 完整名称显示 */}
        <div className="px-2 py-1.5 text-sm font-semibold border-b">
          {isGuest ? "访客" : user?.email || "用户"}
        </div>
        <DropdownMenuItem
          className="cursor-pointer"
          data-testid="user-nav-item-theme"
          onSelect={() => {
            if (resolvedTheme) {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }
          }}
        >
          {resolvedTheme
            ? `切换到${resolvedTheme === "light" ? "深色" : "浅色"}模式`
            : "切换主题"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild data-testid="user-nav-item-auth">
          <button
            className="w-full cursor-pointer text-left"
            onClick={() => {
              if (status === "loading") {
                toast({
                  type: "error",
                  description:
                    "正在检查认证状态，请稍后再试！",
                });

                return;
              }

              if (isGuest) {
                router.push("/login");
              } else {
                // 注销时先更新后端在线状态，然后调用 NextAuth signOut
                const memberId = data?.user ? getBackendMemberId(data.user) : null;
                if (memberId) {
                  // 异步更新后端状态，不阻塞注销流程
                  updateBackendOnlineStatus(memberId, false).catch(() => {
                    // 错误已在函数内部处理
                  });
                }
                
                signOut({
                  redirectTo: "/",
                });
              }
            }}
            type="button"
          >
            {isGuest ? "登录您的账号" : "退出登录"}
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
