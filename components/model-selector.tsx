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

  // 分离 agents 和 users
  // 统一使用好友列表的逻辑：显示所有agents（包括动态智能体），不进行权限过滤
  // 权限过滤应该在发送消息时进行，而不是在显示列表时
  const availableAgents = chatModels.filter((chatModel) => {
    return chatModel.type === "agent";
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

  // 判断选中的模型是否是当前用户（本地用户不显示状态）
  const isSelectedCurrentUser = useMemo(() => {
    if (!selectedChatModel || selectedChatModel.type !== "user" || !isLoggedIn || !session?.user) {
      return false;
    }
    const currentUserId = getBackendMemberId(session.user);
    if (!currentUserId) return false;
    const modelMemberId = selectedChatModel.id.replace(/^user::/, "");
    return modelMemberId === currentUserId;
  }, [selectedChatModel, isLoggedIn, session]);

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
          className="h-9 px-3 gap-2"
          data-testid="model-selector"
          variant="outline"
        >
          {selectedChatModel && (
            <UnifiedAvatar
              name={selectedChatModel.name}
              id={selectedChatModel.id}
              isAgent={selectedChatModel.avatar.isAgent}
              size={5}
              showStatus={selectedChatModel.type === "user" && !isSelectedCurrentUser}
              isOnline={selectedChatModel.type === "user" ? selectedChatModel.isOnline : undefined}
            />
          )}
          <span className="text-sm font-medium truncate max-w-[120px] sm:max-w-[160px]">
            {selectedChatModel?.name || "选择收信方"}
          </span>
          <ChevronDownIcon className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[240px] max-w-[90vw] sm:min-w-[260px] max-h-[70vh] overflow-y-auto"
      >
        {/* 智能体分组 */}
        {availableAgents.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              智能体
            </div>
            {modelsWithAvatars
              .filter((m) => m.type === "agent")
              .map((chatModel) => {
                const { id } = chatModel;
                const isSelected = id === optimisticModelId;

                return (
                  <DropdownMenuItem
                    asChild
                    data-active={isSelected}
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
                      className={cn(
                        "group/item flex w-full flex-row items-center justify-between gap-2 px-2 py-1.5 rounded-sm",
                        "hover:bg-accent transition-colors",
                        isSelected && "bg-accent"
                      )}
                      type="button"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <UnifiedAvatar
                          name={chatModel.name}
                          id={chatModel.id}
                          isAgent={true}
                          size={6}
                        />
                        <div className="text-sm truncate">{chatModel.name}</div>
                      </div>

                      {isSelected && (
                        <div className="shrink-0 text-foreground">
                          <CheckCircleFillIcon className="size-4" />
                        </div>
                      )}
                    </button>
                  </DropdownMenuItem>
                );
              })}
          </>
        )}
        
        {/* 用户分组 */}
        {availableUsers.length > 0 && (
          <>
            {availableAgents.length > 0 && (
              <DropdownMenuSeparator className="my-1" />
            )}
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              用户
            </div>
            {modelsWithAvatars
              .filter((m) => m.type === "user")
              .map((chatModel) => {
                const { id } = chatModel;
                const isSelected = id === optimisticModelId;
                
                // 判断是否是当前用户（本地用户不显示状态）
                const isModelCurrentUser = (() => {
                  if (!isLoggedIn || !session?.user) return false;
                  const currentUserId = getBackendMemberId(session.user);
                  if (!currentUserId) return false;
                  const modelMemberId = id.replace(/^user::/, "");
                  return modelMemberId === currentUserId;
                })();

                return (
                  <DropdownMenuItem
                    asChild
                    data-active={isSelected}
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
                      className={cn(
                        "group/item flex w-full flex-row items-center justify-between gap-2 px-2 py-1.5 rounded-sm",
                        "hover:bg-accent transition-colors",
                        isSelected && "bg-accent"
                      )}
                      type="button"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <UnifiedAvatar
                          name={chatModel.name}
                          id={chatModel.id}
                          isAgent={false}
                          size={6}
                          showStatus={!isModelCurrentUser}
                          isOnline={chatModel.isOnline}
                        />
                        <div className="text-sm truncate">{chatModel.name}</div>
                      </div>

                      {isSelected && (
                        <div className="shrink-0 text-foreground">
                          <CheckCircleFillIcon className="size-4" />
                        </div>
                      )}
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
