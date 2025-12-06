import { compare } from "bcrypt-ts"
import NextAuth, { type DefaultSession } from "next-auth"
import type { DefaultJWT } from "next-auth/jwt"
import Credentials from "next-auth/providers/credentials"
import { DUMMY_PASSWORD } from "@/lib/constants"
import { createGuestUser, getUser, createUser } from "@/lib/db/queries"

const authConfig = {
  pages: {
    signIn: "/login",
    newUser: "/",
    error: "/login",
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60,
  },
  debug: process.env.NODE_ENV === "development",
  trustHost: true,
}

export type UserType = "guest" | "regular"

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string
      email?: string | null
      type: UserType
      memberId?: string | null // 后端用户 ID（member_id）
    } & DefaultSession["user"]
  }

  // biome-ignore lint/nursery/useConsistentTypeDefinitions: "Required"
  interface User {
    id?: string
    email?: string | null
    type: UserType
    memberId?: string | null // 后端用户 ID（member_id）
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string
    email?: string | null
    type: UserType
    memberId?: string | null // 后端用户 ID（member_id）
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // 明确类型转换
        const email = String(credentials.email)
        const password = String(credentials.password)

        try {
          // 调用内部认证 API 路由（更安全，统一错误处理）
          // 在服务器端，使用环境变量或默认值
          const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:8000"
          const loginUrl = `${baseUrl}/api/auth/backend/login`

          console.log("[auth] Attempting login:", {
            email,
            baseUrl,
            loginUrl,
            hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
            hasAuthUrl: !!process.env.AUTH_URL,
          })

          const response = await fetch(loginUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email,
              password,
            }),
            // 添加超时控制（10秒）
            signal: AbortSignal.timeout(10000),
          })

          if (!response.ok) {
            // 登录失败，防止时序攻击
            await compare(password, DUMMY_PASSWORD)
            return null
          }

          const data = await response.json()

          if (!data.success || !data.user) {
            await compare(password, DUMMY_PASSWORD)
            return null
          }

          // 同步用户到前端数据库（如果不存在则创建）
          let frontendUser = await getUser(email)
          if (frontendUser.length === 0) {
            // 用户不存在，创建新用户（不存储密码，因为认证在后端）
            await createUser(email, "")
            frontendUser = await getUser(email)
          }

          if (frontendUser.length === 0) {
            // 创建失败，防止时序攻击
            await compare(password, DUMMY_PASSWORD)
            return null
          }

          // 返回用户信息，使用前端数据库的 UUID 作为 id
          const [user] = frontendUser
          // 从后端返回的数据中获取 member_id
          const backendMemberId = data.user.member_id || null
          return {
            id: user.id,
            email: email, // 确保是 string 类型
            name: (data.user.nickname || email) as string,
            type: "regular" as const,
            memberId: backendMemberId, // 存储后端用户 ID
          }
        } catch (error) {
          // 网络错误或其他错误，防止时序攻击
          console.error("[Auth] 认证错误:", error)
          await compare(password, DUMMY_PASSWORD)
          return null
        }
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser()
        return {
          id: guestUser.id,
          email: guestUser.email || null,
          name: "Guest",
          type: "guest" as const,
          memberId: null,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.type = user.type
        token.email = user.email || null
        token.memberId = user.memberId || null // 存储后端用户 ID
      }

      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.type = token.type
        // 确保 email 字段被传递到 session
        if (token.email) {
          session.user.email = token.email
        }
        // 传递后端用户 ID
        if (token.memberId) {
          session.user.memberId = token.memberId
        }
      }

      return session
    },
  },
})
