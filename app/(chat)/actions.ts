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
    const messageText = getTextFromMessage(message);
    
    if (!messageText || messageText.trim().length === 0) {
      return "新对话";
    }

    const trimmedText = messageText.trim();
    if (trimmedText.length === 0) {
      return "新对话";
    }

    // 注意：AI SDK 的 generateText 不支持直接传递 userId 和 conversationId
    // 需要通过 providerOptions 传递这些参数
    // 标准格式：如果未提供 conversationId，使用 title_{user_id}_{timestamp} 格式
    const defaultConversationId = conversationId || `title_${userId || "temp_user"}_${Date.now()}`;
    const { text: title } = await generateText({
      model: myProvider.languageModel("title-model"),
      system: titlePrompt,
      prompt: trimmedText, // 使用 trim 后的文本
      providerOptions: {
        backend: {
          userId: userId || "temp_user",
          conversationId: defaultConversationId,
        },
      },
    });

    return title || "新对话";
  } catch (error) {
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
