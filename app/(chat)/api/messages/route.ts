import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId, saveMessages } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { convertToDBMessages } from "@/lib/utils";

/**
 * 消息持久化 API 端点
 * 符合 AI SDK 规范的消息保存机制
 * 
 * 参考: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot/message-persistence
 * 
 * 功能：
 * 1. 保存 assistant 消息到数据库
 * 2. 避免重复保存
 * 3. 错误处理和验证
 */
export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const body = await request.json();
    const { chatId, messages }: { chatId: string; messages: ChatMessage[] } = body;

    if (!chatId || !messages || !Array.isArray(messages)) {
      return new ChatSDKError(
        "bad_request:api",
        "chatId and messages array are required"
      ).toResponse();
    }

    // 验证聊天是否存在且用户有权限
    const chat = await getChatById({ id: chatId });
    if (!chat) {
      return new ChatSDKError("not_found:chat").toResponse();
    }

    if (chat.userId !== session.user.id) {
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    // 验证消息格式（符合 AI SDK 规范）
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ success: true, saved: 0, message: "No messages to save" });
    }

    // 验证消息结构
    const invalidMessages = messages.filter(
      (msg) => !msg.id || !msg.role || !msg.parts || !Array.isArray(msg.parts)
    );
    if (invalidMessages.length > 0) {
      console.warn("[messages/route] Invalid message format detected:", invalidMessages.length);
      if (process.env.NODE_ENV === "development") {
        console.warn("[messages/route] Invalid messages:", invalidMessages);
      }
    }

    // 获取数据库中已有的消息 ID，避免重复保存
    const existingMessages = await getMessagesByChatId({ id: chatId });
    const existingMessageIds = new Set(existingMessages.map((msg) => msg.id));

    // 只保存新的 assistant 消息（用户消息已经在发送前保存）
    // 符合 AI SDK 规范：只持久化 assistant 消息
    // 确保消息有有效的 parts（非空数组且有实际内容）
    const assistantMessages = messages.filter((msg) => {
      if (msg.role !== "assistant") return false;
      if (existingMessageIds.has(msg.id)) return false;
      if (!msg.id) return false;
      if (!msg.parts || !Array.isArray(msg.parts)) return false;
      if (msg.parts.length === 0) return false;

      // 检查是否有有效内容（文本、文件或其他类型）
      // 排除 "data-appendMessage" 类型，这是错误格式
      let hasValidContent = false;
      let hasDataAppend = false;
      for (const p of msg.parts as any[]) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "data-appendMessage") {
          hasDataAppend = true;
          continue;
        }
        if (p.type === "text" && p.text && p.text.trim().length > 0) {
          hasValidContent = true;
          break;
        }
        if (p.type === "file") {
          hasValidContent = true;
          break;
        }
        if (p.type !== "text" && p.type !== "file") {
          hasValidContent = true;
          break;
        }
      }

      if (!hasValidContent) return false;
      return true;
    });

    if (assistantMessages.length === 0) {
      return Response.json({ 
        success: true, 
        saved: 0,
        message: "No new assistant messages to save"
      });
    }

    // 转换为数据库格式
    const dbMessages = convertToDBMessages(assistantMessages, chatId);

    // 保存到数据库（符合 AI SDK 持久化最佳实践）
    try {
      await saveMessages({ messages: dbMessages });
      
      console.log(`[messages/route] ✅ Successfully saved ${dbMessages.length} message(s) to database`);
    } catch (error) {
      console.error("[messages/route] Failed to save messages to database:", error);
      
      // 如果是重复键错误，忽略（可能是并发请求导致的）
      // 这符合 AI SDK 的幂等性要求
      if (
        error instanceof Error &&
        (error.message.includes("duplicate key") ||
          error.message.includes("UNIQUE constraint"))
      ) {
        console.warn("[messages/route] Message already exists (idempotent), skipping");
        return Response.json({ 
          success: true, 
          saved: 0, 
          skipped: true,
          message: "Messages already exist"
        });
      }
      throw error;
    }

    return Response.json({
      success: true,
      saved: dbMessages.length,
      messageIds: dbMessages.map((msg) => msg.id),
    });
  } catch (error) {
    console.error("[messages/route] Failed to save messages:", error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return new ChatSDKError(
      "offline:chat",
      error instanceof Error ? error.message : "Failed to save messages"
    ).toResponse();
  }
}

