"use client";

import type { Session } from "next-auth";
import { startTransition, useMemo, useOptimistic, useState } from "react";
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
import { useChatModels } from "@/lib/ai/models-client";
import { getAvatarInfo, preloadAvatars } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";
import { CheckCircleFillIcon, ChevronDownIcon, BotIcon, UserIcon } from "./icons";

export function ModelSelector({
  session,
  selectedModelId,
  className,
}: {
  session: Session;
  selectedModelId: string;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [optimisticModelId, setOptimisticModelId] =
    useOptimistic(selectedModelId);

  const userType = session.user.type;
  const isLoggedIn = userType === "regular";
  
  // 从后端获取模型列表（登录用户包含用户列表）
  const { models: chatModels } = useChatModels(isLoggedIn);

  const { availableChatModelIds } = entitlementsByUserType[userType];

  // 调试日志
  console.log("[ModelSelector] Debug info:", {
    userType,
    isLoggedIn,
    chatModelsCount: chatModels.length,
    chatModels: chatModels.map(m => ({ id: m.id, name: m.name, type: m.type })),
    availableChatModelIds,
  });

  // 分离 agents 和 users
  const availableAgents = chatModels.filter((chatModel) => {
    if (chatModel.type === "user") return false;
    return availableChatModelIds.includes(chatModel.id);
  });

  const availableUsers = chatModels.filter((chatModel) => {
    if (chatModel.type !== "user") return false;
    // 登录用户可以看到所有用户（除了自己）
    if (isLoggedIn) {
      const currentUserId = session.user.memberId || session.user.email?.split("@")[0] || session.user.id;
      return chatModel.id !== `user::${currentUserId}`;
    }
    return false;
  });

  // 调试日志
  console.log("[ModelSelector] Filtered:", {
    availableAgents: availableAgents.map(m => ({ id: m.id, name: m.name })),
    availableUsers: availableUsers.map(m => ({ id: m.id, name: m.name, isOnline: m.isOnline })),
  });

  // 合并列表：agents 在前，users 在后
  const availableChatModels = [...availableAgents, ...availableUsers];
  
  // 预加载所有模型的头像信息
  const modelsWithAvatars = useMemo(() => {
    return preloadAvatars(availableChatModels);
  }, [availableChatModels]);

  const selectedChatModel = useMemo(() => {
    // 查找选中的模型（可能是agent或user）
    return modelsWithAvatars.find(
      (chatModel) => chatModel.id === optimisticModelId
    ) || modelsWithAvatars[0]; // 如果找不到，使用第一个
  }, [optimisticModelId, modelsWithAvatars]);

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
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
            <div
              className="mr-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-white border border-blue-500"
              style={{
                color: "#3B82F6",
              }}
            >
              {selectedChatModel.avatar.isAgent ? (
                <BotIcon variant={selectedChatModel.avatar.iconVariant} />
              ) : (
                <UserIcon variant={selectedChatModel.avatar.iconVariant} />
              )}
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
                        <div
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white border border-blue-500"
                          style={{
                            color: "#3B82F6",
                          }}
                        >
                          <BotIcon variant={chatModel.avatar.iconVariant} />
                        </div>
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
                        <div
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white border border-blue-500"
                          style={{
                            color: "#3B82F6",
                          }}
                        >
                          <UserIcon variant={chatModel.avatar.iconVariant} />
                        </div>
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm sm:text-base">{chatModel.name}</div>
                            {chatModel.isOnline && (
                              <span className="size-2 rounded-full bg-green-500" />
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
