import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * GET /api/collections - 获取收藏列表
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

    // 调用后端 API 获取收藏列表
    const response = await fetch(
      `${BACKEND_URL}/api/collections?user_id=${encodeURIComponent(userId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      // 如果返回 404，说明后端接口可能还未实现或列表为空，返回空数组
      if (response.status === 404) {
        return NextResponse.json([]);
      }
      // 其他错误也返回空数组，避免前端报错
      console.error("[Collections API] 获取收藏列表失败:", response.status, response.statusText);
      return NextResponse.json([]);
    }

    const data = await response.json();
    // 后端返回格式：{ success: true, collections: [...] }
    // 前端需要返回数组格式
    if (data && Array.isArray(data.collections)) {
      return NextResponse.json(data.collections);
    }
    // 如果已经是数组格式，直接返回
    if (Array.isArray(data)) {
      return NextResponse.json(data);
    }
    // 默认返回空数组
    return NextResponse.json([]);
  } catch (error) {
    console.error("[Collections API] Error:", error);
    return NextResponse.json(
      { error: "获取收藏列表失败" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/collections - 添加收藏
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { chat_id, message_id, message_content, message_role, sender_name } = body;

    if (!chat_id || !message_id || !message_content) {
      return NextResponse.json(
        { error: "缺少必要参数" },
        { status: 400 }
      );
    }

    // 调用后端 API 添加收藏
    const response = await fetch(`${BACKEND_URL}/api/collections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        chat_id,
        message_id,
        message_content,
        message_role: message_role || "user",
        sender_name: sender_name || null, // 传递发送者名称
      }),
    });

    if (!response.ok) {
      throw new Error("添加收藏失败");
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Collections API] Error:", error);
    return NextResponse.json(
      { error: "添加收藏失败" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/collections - 删除收藏
 */
export async function DELETE(request: NextRequest) {
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
    const collectionId = searchParams.get("id");
    const messageId = searchParams.get("message_id");

    if (!collectionId && !messageId) {
      return NextResponse.json(
        { error: "缺少收藏ID或消息ID" },
        { status: 400 }
      );
    }

    // 调用后端 API 删除收藏
    let url = `${BACKEND_URL}/api/collections?user_id=${encodeURIComponent(userId)}`;
    if (messageId) {
      url += `&message_id=${encodeURIComponent(messageId)}`;
    } else if (collectionId) {
      url += `&id=${encodeURIComponent(collectionId)}`;
    }
    
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("删除收藏失败");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Collections API] Error:", error);
    return NextResponse.json(
      { error: "删除收藏失败" },
      { status: 500 }
    );
  }
}

