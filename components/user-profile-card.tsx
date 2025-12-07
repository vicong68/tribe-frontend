"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { getBackendMemberId } from "@/lib/user-utils";
import { getAvatarInfo } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";
import { UserIcon } from "./icons";
import { Skeleton } from "./ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Separator } from "./ui/separator";
import { UnifiedAvatar } from "./unified-avatar";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

interface UserProfile {
  member_id: string;
  nickname: string;
  user_group: string;
  introduction: string;
  avatar_url?: string | null;
  avatar_icon: string;
  created_at?: string | null;
  last_login_at?: string | null;
  is_online: boolean;
}

interface UserProfileResponse {
  success: boolean;
  profile: UserProfile;
}

/**
 * 用户详细信息卡片组件
 * 显示登录用户的完整资料信息
 */
export function UserProfileCard() {
  const { data: session, status } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const userId = isLoggedIn && session?.user
    ? getBackendMemberId(session.user)
    : null;

  // 获取用户资料
  const { data: profileData, isLoading, error } = useSWR<UserProfileResponse>(
    userId ? `/api/user/profile/${userId}` : null,
    async (url: string) => {
      const response = await fetch(`${BACKEND_URL}${url}`);
      if (!response.ok) {
        throw new Error("Failed to fetch user profile");
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 0,
    }
  );

  const profile = profileData?.profile;
  const avatarInfo = profile ? getAvatarInfo(profile.member_id, profile.avatar_icon, profile.avatar_url) : null;

  // 格式化日期
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "未知";
    try {
      const date = new Date(dateString);
      return date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "未知";
    }
  };

  // 未登录状态
  if (!isLoggedIn || status === "loading") {
    return (
      <Card className="border-0 shadow-none bg-sidebar">
        <CardContent className="space-y-3 p-6">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  // 加载中状态
  if (isLoading) {
    return (
      <Card className="border-0 shadow-none bg-sidebar">
        <CardContent className="space-y-3 p-6">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  // 错误状态
  if (error || !profile) {
    return (
      <Card className="border-0 shadow-none bg-sidebar">
        <CardContent className="p-6">
          <div className="text-sm text-muted-foreground">
            无法加载用户信息
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-none bg-sidebar">
      <CardContent className="space-y-3 p-6">
        {/* 头像和基本信息 */}
        <div className="flex items-start gap-3">
          <UnifiedAvatar
            name={profile.nickname}
            id={profile.member_id}
            isAgent={false}
            size={12}
            showStatus={true}
            isOnline={profile.is_online}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{profile.nickname}</div>
            <div className="text-xs text-muted-foreground truncate">
              {profile.member_id}
            </div>
          </div>
        </div>

        <Separator />

        {/* 详细信息 */}
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">用户分组</span>
            <span className="font-medium">{profile.user_group || "未设置"}</span>
          </div>
          {profile.introduction && (
            <div className="space-y-1">
              <span className="text-muted-foreground">个人介绍</span>
              <div className="text-sm break-words">{profile.introduction}</div>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">注册时间</span>
            <span className="text-xs">{formatDate(profile.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">最后登录</span>
            <span className="text-xs">{formatDate(profile.last_login_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">在线状态</span>
            <span className={cn(
              "text-xs font-medium",
              profile.is_online ? "text-green-600" : "text-muted-foreground"
            )}>
              {profile.is_online ? "在线" : "离线"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

