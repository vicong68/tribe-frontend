/**
 * 后端注册 API 路由
 * 作为 NextAuth 和后端之间的中间层，提供标准化的认证接口
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

const registerRequestSchema = z.object({
  email: z.string().email("无效的邮箱地址"),
  password: z.string().min(6, "密码至少需要6个字符"),
  nickname: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // 验证请求数据
    const validatedData = registerRequestSchema.parse(body);

    // 调用后端注册 API
    const response = await fetch(`${BACKEND_API_URL}/api/chat/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "register",
        member_id: validatedData.email,
        password: validatedData.password,
        nickname: validatedData.nickname || validatedData.email.split("@")[0],
        user_group: "初级",
      }),
    });

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { detail: "注册失败" };
      }

      // 解析后端统一错误格式
      const errorMessage =
        errorData.message ||
        (typeof errorData.detail === "string"
          ? errorData.detail
          : errorData.detail?.message || "注册失败");

      // 检查是否是用户已存在的错误（409）
      const isUserExists =
        response.status === 409 || errorMessage.includes("已存在");

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          code: isUserExists ? "USER_EXISTS" : "REGISTER_FAILED",
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!data.success || !data.member_data) {
      return NextResponse.json(
        {
          success: false,
          error: data.message || "注册失败",
          code: "REGISTER_FAILED",
        },
        { status: 400 }
      );
    }

    // 返回成功响应
    return NextResponse.json({
      success: true,
      user: {
        email: validatedData.email,
        member_id: data.member_data.member_id,
        nickname: data.member_data.nickname || validatedData.email.split("@")[0],
        user_group: data.member_data.user_group,
        email_from_backend: data.member_data.email,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "请求数据验证失败",
          code: "VALIDATION_ERROR",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error("[Auth API] 注册错误:", error);
    return NextResponse.json(
      {
        success: false,
        error: "服务器内部错误",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

