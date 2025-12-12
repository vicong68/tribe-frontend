"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import { titlePrompt } from "@/lib/ai/prompts";
import { myProvider } from "@/lib/ai/providers";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import { getTextFromMessage, generateLightweightTitle } from "@/lib/utils";
import { updateChatById } from "@/lib/db/queries";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
  userId,
  conversationId,
  lightweight = false,
}: {
  message: UIMessage;
  userId?: string;
  conversationId?: string;
  lightweight?: boolean; // 轻量级模式：使用快速规则，不调用后端
}) {
  try {
    const messageText = getTextFromMessage(message);
    const trimmedText = messageText?.trim() || "";
    const createdAt = message.metadata?.createdAt;
    
    if (!trimmedText) {
      console.log("[generateTitle] 消息文本为空，返回默认标题");
      return "新对话";
    }

    // 轻量级模式：使用快速规则生成标题（无需调用后端）
    if (lightweight) {
      const title = generateLightweightTitle(trimmedText, createdAt);
      console.log("[generateTitle] ✅ 轻量级标题生成成功:", {
        title,
        createdAt,
        messagePreview: trimmedText.substring(0, 50) + (trimmedText.length > 50 ? "..." : ""),
      });
      return title;
    }

    // AI 生成模式：调用后端生成标题（备用方案）
    // 注意：AI SDK 的 generateText 不支持直接传递 userId 和 conversationId
    // 需要通过 providerOptions 传递这些参数
    // 标准格式：如果未提供 conversationId，使用 title_{user_id}_{timestamp} 格式
    const defaultConversationId = conversationId || `title_${userId || "temp_user"}_${Date.now()}`;
    
    console.log("[generateTitle] 开始 AI 生成标题:", {
      userId,
      conversationId: defaultConversationId,
      messagePreview: trimmedText.substring(0, 50) + (trimmedText.length > 50 ? "..." : ""),
    });
    
    const startTime = Date.now();
    const result = await generateText({
      model: myProvider.languageModel("title-model"),
      system: titlePrompt,
      prompt: trimmedText,
      providerOptions: {
        backend: {
          userId: userId || "temp_user",
          conversationId: defaultConversationId,
        },
      },
    });

    const title = result.text?.trim().replace(/^["']|["']$/g, "").replace(/:/g, "") || "";
    const duration = Date.now() - startTime;
    
    if (!title || title === "新对话") {
      console.warn("[generateTitle] ⚠️ AI 生成的标题无效，使用轻量级标题", { duration: `${duration}ms` });
      return generateLightweightTitle(trimmedText);
    }

    console.log("[generateTitle] ✅ AI 标题生成成功:", {
      title,
      duration: `${duration}ms`,
      userId,
      conversationId: defaultConversationId,
    });

    return title;
  } catch (error) {
    const errorInfo = error instanceof Error 
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: String(error), name: typeof error };
    
    console.error("[generateTitle] ❌ 标题生成失败，使用轻量级标题:", {
      ...errorInfo,
      userId,
      conversationId,
    });
    // 失败时回退到轻量级标题
    const messageText = getTextFromMessage(message);
    return generateLightweightTitle(messageText?.trim() || "");
  }
}

/**
 * 异步更新聊天标题（不阻塞主流程）
 * 先使用轻量级标题，然后异步更新为 AI 生成的标题
 */
export async function updateChatTitleAsync({
  chatId,
  message,
  userId,
  conversationId,
}: {
  chatId: string;
  message: UIMessage;
  userId?: string;
  conversationId?: string;
}) {
  // 异步执行，不阻塞主流程
  Promise.resolve().then(async () => {
    try {
      const aiTitle = await generateTitleFromUserMessage({
        message,
        userId,
        conversationId,
        lightweight: false, // 使用 AI 生成
      });
      
      // 只有当 AI 生成的标题与轻量级标题不同时才更新
      const messageText = getTextFromMessage(message);
      const lightweightTitle = generateLightweightTitle(
        messageText?.trim() || "",
        message.metadata?.createdAt,
      );
      
      if (aiTitle && aiTitle !== lightweightTitle && aiTitle !== "新对话") {
        await updateChatById({ id: chatId, title: aiTitle });
        console.log("[updateChatTitleAsync] ✅ 异步更新标题成功:", {
          chatId,
          oldTitle: lightweightTitle,
          newTitle: aiTitle,
        });
      }
    } catch (error) {
      // 静默处理错误，不影响主流程
      console.warn("[updateChatTitleAsync] ⚠️ 异步更新标题失败:", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisibilityById({ chatId, visibility });
}
