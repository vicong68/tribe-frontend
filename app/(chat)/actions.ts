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
import { getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
  userId,
  conversationId,
}: {
  message: UIMessage;
  userId?: string;
  conversationId?: string;
}) {
  try {
    // 调试：检查 message 对象结构
    console.log("[generateTitleFromUserMessage] Message object:", {
      hasParts: !!message.parts,
      partsLength: message.parts?.length || 0,
      parts: message.parts,
      messageId: message.id,
      role: message.role,
    });
    
    const messageText = getTextFromMessage(message);
    
    // 调试：检查提取的文本
    console.log("[generateTitleFromUserMessage] Extracted text:", {
      messageText,
      textLength: messageText?.length || 0,
      trimmedLength: messageText?.trim().length || 0,
    });
    
    if (!messageText || messageText.trim().length === 0) {
      console.warn("[generateTitleFromUserMessage] Message text is empty, returning default title", {
        messageText,
        parts: message.parts,
      });
      return "新对话";
    }

    // 验证消息文本不为空后再调用 generateText
    const trimmedText = messageText.trim();
    if (trimmedText.length === 0) {
      console.warn("[generateTitleFromUserMessage] Trimmed message text is empty, returning default title");
      return "新对话";
    }

    // 注意：AI SDK 的 generateText 不支持直接传递 userId 和 conversationId
    // 需要通过 providerOptions 传递这些参数
    const { text: title } = await generateText({
      model: myProvider.languageModel("title-model"),
      system: titlePrompt,
      prompt: trimmedText, // 使用 trim 后的文本
      providerOptions: {
        backend: {
          userId: userId || "temp_user",
          conversationId: conversationId || `title_${Date.now()}`,
        },
      },
    });

    return title || "新对话";
  } catch (error) {
    console.error("[generateTitleFromUserMessage] Error:", error);
    // 如果是内容为空的错误，直接返回默认标题，不记录错误
    if (error instanceof Error && error.message.includes("empty")) {
      console.warn("[generateTitleFromUserMessage] Empty content error, returning default title");
      return "新对话";
    }
    return "新对话";
  }
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
