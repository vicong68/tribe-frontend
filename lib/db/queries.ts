import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import type { VisibilityType } from "@/components/visibility-selector";
import { ChatSDKError } from "../errors";
import type { AppUsage } from "../usage";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// 检查数据库连接配置
if (!process.env.POSTGRES_URL) {
  const errorMsg = "POSTGRES_URL environment variable is not set. Please check your .env.local file.";
  console.error("[Database] ❌", errorMsg);
  throw new Error(errorMsg);
}

// 移除 URL 中的 schema 参数（postgres.js 不支持），稍后通过 search_path 设置
const dbUrl = process.env.POSTGRES_URL.replace(/\?schema=[^&]*/, "").replace(/&schema=[^&]*/, "");

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(dbUrl, {
  // 设置默认 schema 为 ai
  search_path: "ai",
  // 连接池配置：防止 "too many clients" 错误
  max: 10, // 最大连接数（根据实际需求调整，建议 5-20）
  idle_timeout: 20, // 空闲连接超时（秒），20秒后关闭空闲连接
  max_lifetime: 60 * 30, // 连接最大生命周期（秒），30分钟后强制关闭连接
  connect_timeout: 10, // 连接超时（秒）
  // 连接池行为
  prepare: false, // 禁用 prepared statements（在某些情况下可以提高性能）
  // 错误处理
  onnotice: () => {}, // 忽略 notice 消息
  // 开发环境调试
  debug: process.env.NODE_ENV === "development" ? false : false, // 设置为 true 可查看 SQL 查询
});

const db = drizzle(client, { schema: undefined }); // Drizzle 会自动使用 search_path

// 测试数据库连接（仅在开发环境）
if (process.env.NODE_ENV === "development") {
  client`SELECT 1`.catch((error) => {
    console.error("[Database] ❌ Failed to connect to database:", error.message);
    if (error.message.includes("too many clients")) {
      console.error("[Database] ⚠️ 连接池已满，请检查是否有连接泄漏");
      console.error("[Database] 💡 建议：");
      console.error("[Database]    1. 检查是否有未关闭的数据库连接");
      console.error("[Database]    2. 增加 PostgreSQL max_connections 配置");
      console.error("[Database]    3. 减少前端连接池大小（当前 max: 10）");
    } else {
      console.error("[Database] 💡 Make sure PostgreSQL is running:");
      console.error("[Database]    sudo systemctl start postgresql");
      console.error("[Database]    or");
      console.error("[Database]    docker-compose up -d postgres");
    }
  });
}

// 优雅关闭：在进程退出时关闭所有连接
if (typeof process !== "undefined") {
  const gracefulShutdown = () => {
    console.log("[Database] 🔄 Closing database connections...");
    client.end({ timeout: 5 });
  };
  
  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
  process.on("exit", gracefulShutdown);
}

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function getUserById(userId: string): Promise<User | null> {
  try {
    const users = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    return users[0] || null;
  } catch (_error) {
    console.error("[getUserById] Database error:", _error);
    return null;
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  // 使用固定的 guest 用户，避免每次访问都创建新用户
  const GUEST_EMAIL = "guest-user@tribe.local";
  
  try {
    // 先检查是否已存在固定的 guest 用户
    const existingGuest = await db
      .select()
      .from(user)
      .where(eq(user.email, GUEST_EMAIL))
      .limit(1);
    
    if (existingGuest.length > 0) {
      // 复用已存在的 guest 用户
      return [
        {
          id: existingGuest[0].id,
          email: existingGuest[0].email,
        },
      ];
    }
    
    // 如果不存在，创建固定的 guest 用户
    const password = generateHashedPassword(generateUUID());
    return await db.insert(user).values({ email: GUEST_EMAIL, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    // 记录详细的错误信息以便调试
    console.error("[createGuestUser] Database error:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to create guest user";
    throw new ChatSDKError(
      "bad_request:database",
      `Failed to create guest user: ${errorMessage}`
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  // 在保存前验证用户是否存在
  const existingUser = await getUserById(userId);
  if (!existingUser) {
    console.warn("[saveChat] User not found, attempting to create/retrieve guest user:", userId);
    // 尝试获取或创建 guest 用户
    try {
      const [guestUser] = await createGuestUser();
      if (guestUser && guestUser.id) {
        // 使用 guest 用户的 ID
        console.info("[saveChat] Using guest user ID instead:", guestUser.id);
        userId = guestUser.id;
      } else {
        throw new ChatSDKError(
          "bad_request:database",
          `用户不存在且无法创建 guest 用户: ${userId}`
        );
      }
    } catch (guestError) {
      console.error("[saveChat] Failed to create/retrieve guest user:", guestError);
      throw new ChatSDKError(
        "bad_request:database",
        `用户不存在或无效: ${userId}`
      );
    }
  }
  
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (error) {
    // 记录详细的数据库错误信息
    console.error("[saveChat] Database error:", {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
      chatId: id,
      userId,
      title,
      visibility,
    });
    
    // 检查是否是重复插入错误
    if (error instanceof Error) {
      if (error.message.includes("duplicate key") || error.message.includes("UNIQUE constraint")) {
        console.warn("[saveChat] Chat already exists, skipping insert:", id);
        // 如果聊天已存在，不抛出错误（可能是并发请求导致的）
        return;
      }
      if (error.message.includes("foreign key") || error.message.includes("violates foreign key constraint")) {
        throw new ChatSDKError(
          "bad_request:database",
          `用户不存在或无效: ${userId}`
        );
      }
    }
    
    throw new ChatSDKError(
      "bad_request:database",
      `Failed to save chat: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    // 记录原始错误信息以便调试
    console.error("[getChatsByUserId] Database error:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to get chats by user id";
    throw new ChatSDKError(
      "bad_request:database",
      errorMessage
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    // 如果是重复键错误（主键冲突），忽略它（幂等性）
    if (
      error instanceof Error &&
      (error.message.includes("duplicate key") ||
        error.message.includes("UNIQUE constraint") ||
        error.message.includes("23505"))
    ) {
      console.warn(
        `[saveMessages] Message(s) already exist (idempotent), skipping: ${messages.map((m) => m.id).join(", ")}`
      );
      return;
    }
    throw new ChatSDKError(
      "bad_request:database",
      `Failed to save messages: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save document");
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessageById({ id }: { id: string }) {
  try {
    // 先删除相关的投票记录
    await db.delete(vote).where(eq(vote.messageId, id));
    
    // 删除消息
    const [deletedMessage] = await db
      .delete(message)
      .where(eq(message.id, id))
      .returning();
    
    return deletedMessage || null;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatById({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, id));
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to update chat title by id"
    );
  }
}

export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  // Store merged server-enriched usage object
  context: AppUsage;
}) {
  try {
    return await db
      .update(chat)
      .set({ lastContext: context })
      .where(eq(chat.id, chatId));
  } catch (error) {
    console.warn("Failed to update lastContext for chat", chatId, error);
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    // 记录错误但不抛出，返回 0 以允许用户继续发送消息
    // 限流检查失败不应该阻止用户使用系统
    console.error("[getMessageCountByUserId] Database error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown database error";
    console.warn(
      `[getMessageCountByUserId] Failed to get message count for user ${id}, returning 0. Error: ${errorMessage}`
    );
    return 0; // 返回 0 而不是抛出错误，避免阻止用户发送消息
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}
