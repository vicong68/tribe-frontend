"use client";

import { getAvatarInfo } from "@/lib/avatar-utils";
import { BotIcon, UserIcon } from "./icons";
import { cn } from "@/lib/utils";

/**
 * 统一头像组件
 * 全局维护用户和智能体头像，基于名称种子生成，避免重复
 * 
 * @param name - 显示名称
 * @param id - 唯一标识（用于生成稳定的头像）
 * @param isAgent - 是否为智能体
 * @param size - 头像大小（默认 8，即 32px）
 * @param showStatus - 是否显示在线状态（仅用户有效）
 * @param isOnline - 在线状态（仅用户有效）
 * @param className - 额外的样式类
 */
export function UnifiedAvatar({
  name,
  id,
  isAgent = false,
  size = 8,
  showStatus = false,
  isOnline,
  className,
}: {
  name: string;
  id?: string;
  isAgent?: boolean;
  size?: number;
  showStatus?: boolean;
  isOnline?: boolean;
  className?: string;
}) {
  const avatarInfo = getAvatarInfo(name, id, isAgent);

  // 根据 size 生成对应的 Tailwind 类名
  const sizeClass = {
    5: "size-5",
    6: "size-6",
    8: "size-8",
    10: "size-10",
    12: "size-12",
  }[size] || "size-8";

  const statusSizeClass = size >= 10 ? "size-3" : "size-2.5";

  return (
    <div className={cn("relative", className)}>
      {avatarInfo?.url ? (
        <img
          src={avatarInfo.url}
          alt={name}
          className={cn(
            "rounded-full object-cover border border-sidebar-border",
            sizeClass
          )}
        />
      ) : (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full",
            "bg-white border border-blue-500",
            sizeClass
          )}
          style={{ color: "#3B82F6" }}
        >
          {isAgent ? (
            <BotIcon variant={avatarInfo.iconVariant} />
          ) : (
            <UserIcon variant={avatarInfo.iconVariant} />
          )}
        </div>
      )}
      {/* 在线状态指示（仅用户且 showStatus 为 true 时显示） */}
      {/* 绿点为在线、红点离线、黄点未知 */}
      {showStatus && !isAgent && (
        <>
          {isOnline === true ? (
            <span
              className={cn(
                "absolute bottom-0 right-0 rounded-full bg-green-500 border-2 border-background",
                statusSizeClass
              )}
              title="在线"
            />
          ) : isOnline === false ? (
            <span
              className={cn(
                "absolute bottom-0 right-0 rounded-full bg-red-500 border-2 border-background",
                statusSizeClass
              )}
              title="离线"
            />
          ) : (
            <span
              className={cn(
                "absolute bottom-0 right-0 rounded-full bg-yellow-500 border-2 border-background",
                statusSizeClass
              )}
              title="状态未知"
            />
          )}
        </>
      )}
      {/* 智能体固定显示在线状态 */}
      {isAgent && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full bg-green-500 border-2 border-background",
            statusSizeClass
          )}
          title="在线"
        />
      )}
    </div>
  );
}

