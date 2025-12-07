"use client";

import type { Session } from "next-auth";
import { startTransition, useMemo, useOptimistic, useState, useEffect, useRef, useCallback } from "react";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { useChatModels, clearModelsCache } from "@/lib/ai/models-client";
import { getAvatarInfo, preloadAvatars } from "@/lib/avatar-utils";
import { getBackendMemberId } from "@/lib/user-utils";
import { useUserStatus } from "@/hooks/use-user-status";
import { cn } from "@/lib/utils";
import { CheckCircleFillIcon, ChevronDownIcon, BotIcon, UserIcon } from "./icons";
import { UnifiedAvatar } from "./unified-avatar";

export function ModelSelector({
  session,
  selectedModelId,
  className,
}: {
  session: Session;
  selectedModelId: string;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // 用于强制刷新
  const [optimisticModelId, setOptimisticModelId] =
    useOptimistic(selectedModelId);

  const userType = session.user.type;
  const isLoggedIn = userType === "regular";
  
  // 从后端获取模型列表（登录用户包含用户列表）
  // 使用 refreshKey 来强制刷新（当打开下拉时）
  const { models: chatModels, loading: modelsLoading } = useChatModels(isLoggedIn, refreshKey);

  // 用户状态管理（快速查询和SSE推送更新）
  const { fetchUserStatus, handleStatusUpdate, getCachedStatus } = useUserStatus({
    isLoggedIn,
    onStatusUpdate: useCallback((updates: Map<string, boolean>) => {
      // 当收到状态更新时，更新本地模型列表中的在线状态
      // 这里通过更新 refreshKey 来触发重新获取（但会使用缓存）
      // 更好的方式是直接更新本地状态，但为了简化，我们使用刷新机制
      setRefreshKey((prev) => prev + 1);
    }, []),
  });

  const { availableChatModelIds } = entitlementsByUserType[userType];

  // 分离 agents 和 users
  const availableAgents = chatModels.filter((chatModel) => {
    if (chatModel.type === "user") return false;
    return availableChatModelIds.includes(chatModel.id);
  });

  const availableUsers = chatModels.filter((chatModel) => {
    if (chatModel.type !== "user") return false;
    // 登录用户可以看到所有用户（除了自己）
    // 注意：必须大小写敏感匹配，不能使用toLowerCase/toUpperCase
    if (isLoggedIn) {
      const currentUserId = getBackendMemberId(session.user) || session.user.id;
      // 精确匹配：user::member_id（大小写敏感）
      const chatModelMemberId = chatModel.id.replace(/^user::/, "");
      return chatModel.id !== `user::${currentUserId}` && 
             chatModelMemberId !== currentUserId;
    }
    return false;
  });

  // 合并列表：agents 在前，users 在后
  const availableChatModels = [...availableAgents, ...availableUsers];
  
  // 预加载所有模型的头像信息，并更新用户在线状态（从缓存）
  const modelsWithAvatars = useMemo(() => {
    const models = preloadAvatars(availableChatModels);
    // 更新用户在线状态（从缓存）
    return models.map((model) => {
      if (model.type === "user") {
        const cachedStatus = getCachedStatus(model.id);
        if (cachedStatus !== undefined) {
          return { ...model, isOnline: cachedStatus };
        }
      }
      return model;
    });
  }, [availableChatModels, getCachedStatus]);

  const selectedChatModel = useMemo(() => {
    // 查找选中的模型（可能是agent或user）
    return modelsWithAvatars.find(
      (chatModel) => chatModel.id === optimisticModelId
    ) || modelsWithAvatars[0]; // 如果找不到，使用第一个
  }, [optimisticModelId, modelsWithAvatars]);

  // 下拉打开时刷新用户列表（获取最新在线状态）
  const handleOpenChange = async (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && isLoggedIn) {
      // 方案1：快速查询用户在线状态（轻量级API，3秒超时）
      const statusMap = await fetchUserStatus();
      if (statusMap.size > 0) {
        // 更新本地状态
        handleStatusUpdate(statusMap);
      }
      
      // 方案2：同时清除缓存并强制刷新完整列表（作为兜底）
      clearModelsCache(true);
      setRefreshKey((prev) => prev + 1);
    }
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange} open={open}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          "w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          className
        )}
      >
        <Button
          className="md:h-[34px] md:px-2"
          data-testid="model-selector"
          variant="outline"
        >
          {selectedChatModel && (
            <div className="mr-2 shrink-0">
              <UnifiedAvatar
                name={selectedChatModel.name}
                id={selectedChatModel.id}
                isAgent={selectedChatModel.avatar.isAgent}
                size={5}
              />
            </div>
          )}
          {selectedChatModel?.name}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[280px] max-w-[90vw] sm:min-w-[300px]"
      >
        {availableAgents.length > 0 && (
          <>
            {modelsWithAvatars
              .filter((m) => m.type === "agent")
              .map((chatModel) => {
                const { id } = chatModel;

                return (
                  <DropdownMenuItem
                    asChild
                    data-active={id === optimisticModelId}
                    data-testid={`model-selector-item-${id}`}
                    key={id}
                    onSelect={() => {
                      setOpen(false);

                      startTransition(() => {
                        setOptimisticModelId(id);
                        saveChatModelAsCookie(id);
                      });
                    }}
                  >
                    <button
                      className="group/item flex w-full flex-row items-center justify-between gap-2 sm:gap-4"
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <UnifiedAvatar
                          name={chatModel.name}
                          id={chatModel.id}
                          isAgent={true}
                          size={6}
                        />
                        <div className="flex flex-col items-start gap-1">
                          <div className="text-sm sm:text-base">{chatModel.name}</div>
                          {chatModel.description && (
                            <div className="line-clamp-2 text-muted-foreground text-xs">
                              {chatModel.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-foreground opacity-0 group-data-[active=true]/item:opacity-100 dark:text-foreground">
                        <CheckCircleFillIcon />
                      </div>
                    </button>
                  </DropdownMenuItem>
                );
              })}
          </>
        )}
        
        {availableUsers.length > 0 && (
          <>
            {availableAgents.length > 0 && <DropdownMenuSeparator />}
            {modelsWithAvatars
              .filter((m) => m.type === "user")
              .map((chatModel) => {
                const { id } = chatModel;

                return (
                  <DropdownMenuItem
                    asChild
                    data-active={id === optimisticModelId}
                    data-testid={`model-selector-item-${id}`}
                    key={id}
                    onSelect={() => {
                      setOpen(false);

                      startTransition(() => {
                        setOptimisticModelId(id);
                        saveChatModelAsCookie(id);
                      });
                    }}
                  >
                    <button
                      className="group/item flex w-full flex-row items-center justify-between gap-2 sm:gap-4"
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <UnifiedAvatar
                          name={chatModel.name}
                          id={chatModel.id}
                          isAgent={false}
                          size={6}
                          showStatus={true}
                          isOnline={chatModel.isOnline}
                        />
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm sm:text-base">{chatModel.name}</div>
                            {/* 在线状态指示：
                                - 绿色圆点：在线
                                - 红色圆点：离线
                                - 黄色圆点：状态不可知（isOnline 为 undefined） */}
                            {chatModel.isOnline === true ? (
                              <span className="size-2 rounded-full bg-green-500" title="在线" />
                            ) : chatModel.isOnline === false ? (
                              <span className="size-2 rounded-full bg-red-500" title="离线" />
                            ) : (
                              <span className="size-2 rounded-full bg-yellow-500" title="状态未知" />
                            )}
                          </div>
                          <div className="line-clamp-2 text-muted-foreground text-xs">
                            用户
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-foreground opacity-0 group-data-[active=true]/item:opacity-100 dark:text-foreground">
                        <CheckCircleFillIcon />
                      </div>
                    </button>
                  </DropdownMenuItem>
                );
              })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
