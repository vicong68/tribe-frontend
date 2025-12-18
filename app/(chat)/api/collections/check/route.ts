import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * GET /api/collections/check - 检查消息是否已收藏
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.type !== "regular") {
      return NextResponse.json(
        { error: "请先登录" },
        { status: 401 }
      );
    }

    const userId = getBackendMemberId(session.user);
    if (!userId) {
      return NextResponse.json(
        { error: "无法获取用户ID" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("message_id");

    if (!messageId) {
      return NextResponse.json(
        { error: "缺少消息ID" },
        { status: 400 }
      );
    }

    // 调用后端 API 检查收藏状态
    const response = await fetch(
      `${BACKEND_URL}/api/collections/check?user_id=${encodeURIComponent(userId)}&message_id=${encodeURIComponent(messageId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      // 404 或其他错误都返回未收藏状态，避免阻塞消息发送流程
      if (response.status !== 404) {
        console.warn(`[Collections Check API] 后端返回错误 ${response.status}`);
      }
      return NextResponse.json({ is_collected: false, collection: null });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    // 任何错误都返回未收藏状态，避免阻塞消息发送流程
    console.warn("[Collections Check API] Error:", error);
    return NextResponse.json({ is_collected: false, collection: null });
  }
}

