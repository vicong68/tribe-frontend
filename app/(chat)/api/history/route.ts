import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { deleteAllChatsByUserId, getChatsByUserId, getUserById } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");

  if (startingAfter && endingBefore) {
    return new ChatSDKError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided."
    ).toResponse();
  }

  let session = null;
  try {
    session = await auth();
  } catch (error) {
    console.error("[history/route] Failed to get session:", error);
    // 如果认证失败，返回空列表而不是错误（允许 guest 用户看到空列表）
    return Response.json({ chats: [], hasMore: false });
  }

  if (!session?.user) {
    // 如果没有用户，返回空列表（guest 用户）
    return Response.json({ chats: [], hasMore: false });
  }

  try {
    // 验证用户是否存在
    const existingUser = await getUserById(session.user.id);
    
    if (!existingUser) {
      console.warn("[history/route] User not found, returning empty list:", session.user.id);
      // 如果用户不存在，返回空列表（可能是 session 中的用户 ID 无效）
      return Response.json({ chats: [], hasMore: false });
    }
    
    const chats = await getChatsByUserId({
      id: session.user.id,
      limit,
      startingAfter,
      endingBefore,
    });

    return Response.json(chats);
  } catch (error) {
    console.error("[history/route] Failed to get chats:", error);
    // 即使数据库查询失败，也返回空列表，避免侧边栏完全无法显示
    return Response.json({ chats: [], hasMore: false });
  }
}

export async function DELETE() {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const result = await deleteAllChatsByUserId({ userId: session.user.id });

  return Response.json(result, { status: 200 });
}
