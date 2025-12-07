import type {
  CoreAssistantMessage,
  CoreToolMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
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
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
      // 合并数据库中的 metadata（所有消息都应该有完整的 metadata）
      ...(message.metadata || {}),
    },
  }));
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

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  if (!message.parts || message.parts.length === 0) {
    return '';
  }
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { type: 'text'; text: string}).text || '')
    .join('');
}
