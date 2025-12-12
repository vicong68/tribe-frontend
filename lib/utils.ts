import type {
  CoreAssistantMessage,
  CoreToolMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO, format, isToday, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/lib/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

/**
 * 带错误处理和重试机制的fetch函数（优化：指数退避重试）
 * 符合用户-Agent交互优化方案：请求重试机制
 */
export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryConfig?: {
    maxRetries?: number;
    retryDelay?: number;
    retryableStatuses?: number[];
  }
) {
  const maxRetries = retryConfig?.maxRetries ?? 3;
  const baseDelay = retryConfig?.retryDelay ?? 1000; // 1秒
  const retryableStatuses = retryConfig?.retryableStatuses ?? [408, 429, 500, 502, 503, 504];
  
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);

      if (!response.ok) {
        // 检查是否可重试
        if (attempt < maxRetries && retryableStatuses.includes(response.status)) {
          // 指数退避：1s, 2s, 4s, 8s
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // 重试
        }
        
        // ✅ 修复：安全地解析错误响应，处理非JSON响应
        let errorData: { code?: string; cause?: string; message?: string; detail?: string } = {};
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            errorData = await response.json();
          } else {
            const text = await response.text();
            errorData = { 
              message: text || `${response.status} ${response.statusText}`,
              detail: `后端返回非JSON响应: ${response.status} ${response.statusText}`
            };
          }
        } catch (parseError) {
          // 如果解析失败，使用状态码和状态文本
          errorData = {
            message: `${response.status} ${response.statusText}`,
            detail: "无法解析后端错误响应"
          };
        }
        
        const errorCode = (errorData.code || "offline:chat") as ErrorCode;
        const errorMessage = errorData.cause || errorData.message || errorData.detail || "请求失败";
        throw new ChatSDKError(errorCode, errorMessage);
      }

      return response;
    } catch (error: unknown) {
      lastError = error;
      
      // 如果是 ChatSDKError，直接抛出（不需要重试）
      if (error instanceof ChatSDKError) {
        throw error;
      }
      
      // 网络错误且未达到最大重试次数时重试
      if (attempt < maxRetries && error instanceof TypeError && error.message.includes('fetch')) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // 重试
      }
      
      // 检查离线状态
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new ChatSDKError('offline:chat');
      }
      
      // 最后一次尝试失败，抛出错误
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
  
  throw lastError;
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 格式化消息时间戳为简洁格式
 * 采用通用的过去时间显示策略：
 * - 今天：AM 9:33、PM 4:55
 * - 30 分钟内：30m ago
 * - 1 小时内：1h ago
 * - 1 天内：2h ago
 * - 7 天内：2d ago
 * - 超过 7 天：Jan 15
 */
export function formatMessageTimestamp(timestamp: string | Date | undefined | null): string {
  if (!timestamp) return "";
  
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    if (isNaN(date.getTime())) return "";
    
    const now = new Date();
    
    // 如果是今天，显示 AM/PM 格式
    if (isToday(date)) {
      return format(date, "a h:mm").toUpperCase();
    }
    
    // 计算时间差（使用统一的过去时间显示策略）
    const minutes = differenceInMinutes(now, date);
    const hours = differenceInHours(now, date);
    const days = differenceInDays(now, date);
    
    // 小于 1 小时：显示分钟数
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    
    // 小于 24 小时（1 天内）：显示小时数
    if (hours < 24) {
      return `${hours}h ago`;
    }
    
    // 小于 7 天：显示天数
    if (days < 7) {
      return `${days}d ago`;
    }
    
    // 超过 7 天：显示日期（如 Jan 15）
    return format(date, "MMM d");
  } catch (error) {
    return "";
  }
}

/**
 * 验证字符串是否为有效的 UUID 格式
 * UUID 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

type ResponseMessageWithoutId = CoreToolMessage | CoreAssistantMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };

export function getMostRecentUserMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

export function getTrailingMessageId({
  messages,
}: {
  messages: ResponseMessage[];
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) { return null; }

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  // 标准格式转换：直接转换数据库消息为 UI 消息格式
  // 所有消息都应该有完整的 metadata（无 metadata 的消息已在数据库层面清理）
  return messages.map((message) => {
    // 确保 parts 是数组，如果为空或无效则使用空数组
    let parts: any[] = [];
    if (Array.isArray(message.parts)) {
      parts = message.parts;
    } else {
      // 如果 parts 不是数组，尝试解析（可能是 JSON 字符串）
      try {
        if (typeof message.parts === "string") {
          const parsed = JSON.parse(message.parts);
          parts = Array.isArray(parsed) ? parsed : [];
        } else {
          parts = [];
        }
      } catch {
        parts = [];
      }
    }
    
    // ✅ 修复：清理错误格式的 parts
    // 如果 parts 包含 {"type":"data-appendMessage","data":"..."} 这种格式，
    // 尝试从 data 字段中解析出实际的消息内容
    // 注意：只提取 assistant 消息的 parts，忽略 user 消息的内容
    const cleanedParts: any[] = [];
    // parts 已经在上面处理过，确保是数组
    for (const part of parts) {
      if (part && typeof part === 'object') {
        // 检查是否是错误格式的 data-appendMessage 事件
        if (part.type === "data-appendMessage" && part.data) {
          try {
            // 尝试解析 data 字段（可能是 JSON 字符串）
            const dataContent = typeof part.data === "string" ? JSON.parse(part.data) : part.data;
            
            // ✅ 关键修复：只提取 assistant 消息的 parts，忽略 user 消息
            // 如果 data 是完整的消息对象，且 role 是 assistant，才提取其 parts
            if (dataContent && dataContent.role === "assistant" && Array.isArray(dataContent.parts)) {
              // 只提取 assistant 消息的 parts
              cleanedParts.push(...dataContent.parts);
            } else if (dataContent && dataContent.role === "user") {
              // 如果是 user 消息，跳过（不应该出现在 assistant 消息的 parts 中）
              if (process.env.NODE_ENV === "development") {
                console.warn("[convertToUIMessages] Skipping user message in assistant parts:", dataContent.id);
              }
              // 不添加任何内容，保持 cleanedParts 为空
            } else if (dataContent && Array.isArray(dataContent.parts) && message.role === "assistant") {
              // 如果没有 role 字段，但当前消息是 assistant，且 data 有 parts，也尝试提取
              // 但需要验证 parts 是否有效
              const validParts = dataContent.parts.filter((p: any) => 
                p && typeof p === 'object' && 
                p.type !== "data-appendMessage" &&
                (p.type === "text" || p.type === "file" || (p.type !== "text" && p.type !== "file"))
              );
              if (validParts.length > 0) {
                cleanedParts.push(...validParts);
              }
            }
          } catch (e) {
            // 解析失败，跳过这个 part
            if (process.env.NODE_ENV === "development") {
              console.warn("[convertToUIMessages] Failed to parse data-appendMessage data:", e);
            }
          }
        } else if (part.type !== "data-appendMessage") {
          // 正常的 part 格式，直接使用（排除 data-appendMessage 类型）
          cleanedParts.push(part);
        }
      }
    }
    
    // 使用清理后的 parts，如果为空则尝试从 message.content 填充文本
    const finalParts =
      cleanedParts.length > 0
        ? cleanedParts
        : (message as any).content
        ? [
            {
              type: "text",
              text: (message as any).content as string,
            },
          ]
        : [];
    
    return {
      id: message.id,
      role: message.role as 'user' | 'assistant' | 'system',
      parts: finalParts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
      metadata: {
        createdAt: formatISO(message.createdAt),
        // 合并数据库中的 metadata（所有消息都应该有完整的 metadata）
        ...(message.metadata || {}),
      },
    };
  });
}

/**
 * 将 UI 消息转换为数据库消息格式
 * 用于保存消息到数据库
 * 注意：如果消息 ID 不是有效的 UUID 格式，会生成新的 UUID 并保存原始 ID 到 metadata
 */
export function convertToDBMessages(
  messages: ChatMessage[],
  chatId: string
): DBMessage[] {
  return messages.map((message) => {
    // 检查消息 ID 是否为有效的 UUID 格式
    let dbMessageId = message.id;
    const metadata = { ...(message.metadata || {}) };
    
    if (!isValidUUID(message.id)) {
      // 生成新的 UUID 作为数据库 ID
      dbMessageId = generateUUID();
      // 将原始 ID 保存在 metadata 中，以便追踪
      metadata.originalMessageId = message.id;
    }
    
    return {
      id: dbMessageId, // 使用有效的 UUID
      chatId,
      role: message.role,
      parts: message.parts || [],
      attachments: [],
      metadata: metadata,
      createdAt: message.metadata?.createdAt
        ? new Date(message.metadata.createdAt)
        : new Date(),
    };
  });
}

/**
 * 轻量级标题生成（无需调用后端，快速生成）
 * 使用对话第一条消息的时间作为标题（格式：YYYY-MM-DD/HH:mm）
 */
export function generateLightweightTitle(
  _messageText: string,
  createdAt?: string | Date,
): string {
  const dateFromMetadata = createdAt ? new Date(createdAt) : new Date();
  const validDate = Number.isNaN(dateFromMetadata.getTime())
    ? new Date()
    : dateFromMetadata;

  // 使用创建时间作为标题，格式：12-11 16:18
  return format(validDate, "MM-dd HH:mm");
}

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  if (!message.parts || message.parts.length === 0) {
    return '';
  }
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { type: 'text'; text: string}).text || '')
    .join('');
}
