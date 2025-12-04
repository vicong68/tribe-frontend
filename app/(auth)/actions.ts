"use server";

import { z } from "zod";
import { signIn } from "./auth";

const authFormSchema = z.object({
  email: z.string().email("无效的邮箱地址"),
  password: z.string().min(6, "密码至少需要6个字符"),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
  message?: string;
};

/**
 * 登录 Action
 * 使用 NextAuth 标准流程，通过内部 API 路由调用后端
 */
export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // 使用 NextAuth 的 signIn 函数（会自动调用 authorize）
    const result = await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    // NextAuth signIn 返回错误对象或 undefined
    if (result?.error) {
      // 解析错误信息
      let errorMessage = "登录失败，请检查用户名和密码";
      
      if (result.error === "CredentialsSignin") {
        errorMessage = "用户名或密码错误";
      } else if (result.error) {
        errorMessage = result.error;
      }

      return {
        status: "failed",
        message: errorMessage,
      };
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        status: "invalid_data",
        message: error.errors[0]?.message || "数据验证失败",
      };
    }

    // 网络错误或其他错误
    if (error instanceof Error) {
      return {
        status: "failed",
        message: error.message || "网络错误，请稍后重试",
      };
    }

    return { status: "failed", message: "登录失败，请稍后重试" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
  message?: string;
};

/**
 * 注册 Action
 * 先调用后端注册，成功后使用 NextAuth 登录
 */
export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // 先调用内部注册 API 路由
    // 在服务器端，使用环境变量或默认值
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:8000";
    const response = await fetch(`${baseUrl}/api/auth/backend/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: validatedData.email,
        password: validatedData.password,
        nickname: validatedData.email.split("@")[0],
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      // 检查是否是用户已存在的错误
      if (data.code === "USER_EXISTS" || response.status === 409) {
        return {
          status: "user_exists",
          message: data.error || "用户已存在",
        };
    }

      return {
        status: "failed",
        message: data.error || "注册失败",
      };
    }

    // 注册成功后，使用 NextAuth 自动登录
    const signInResult = await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    if (signInResult?.error) {
      // 注册成功但登录失败（不太可能，但需要处理）
      return {
        status: "failed",
        message: "注册成功，但自动登录失败，请手动登录",
      };
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        status: "invalid_data",
        message: error.errors[0]?.message || "数据验证失败",
      };
    }

    // 网络错误或其他错误
    if (error instanceof Error) {
      return {
        status: "failed",
        message: error.message || "网络错误，请稍后重试",
      };
    }

    return { status: "failed", message: "注册失败，请稍后重试" };
  }
};
