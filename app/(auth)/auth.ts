import NextAuth, { type DefaultSession } from "next-auth"
import type { DefaultJWT } from "next-auth/jwt"
import Credentials from "next-auth/providers/credentials"

const hasDatabase =
  typeof process !== "undefined" && typeof process.env.POSTGRES_URL === "string" && process.env.POSTGRES_URL.length > 0

const getCompare = async () => {
  if (!hasDatabase) return async () => false
  try {
    const { compare } = await import("bcrypt-ts")
    return compare
  } catch (error) {
    console.error("[auth] Failed to load bcrypt-ts:", error)
    return async () => false
  }
}

const getQueries = async () => {
  if (!hasDatabase) return null
  try {
    return await import("@/lib/db/queries")
  } catch (error) {
    console.error("[auth] Failed to load db queries:", error)
    return null
  }
}

const getDummyPassword = async () => {
  if (!hasDatabase) return ""
  try {
    const { DUMMY_PASSWORD } = await import("@/lib/constants")
    return DUMMY_PASSWORD
  } catch (error) {
    console.error("[auth] Failed to load constants:", error)
    return ""
  }
}

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
      memberId?: string | null
    } & DefaultSession["user"]
  }

  interface User {
    id?: string
    email?: string | null
    type: UserType
    memberId?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string
    email?: string | null
    type: UserType
    memberId?: string | null
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
        if (!hasDatabase) {
          console.log("[auth] Database not available, blocking credentials login")
          return null
        }

        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = String(credentials.email)
        const password = String(credentials.password)

        try {
          const compare = await getCompare()
          const queries = await getQueries()
          const DUMMY_PASSWORD = await getDummyPassword()

          if (!queries) {
            console.log("[auth] Queries not available")
            return null
          }

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
            signal: AbortSignal.timeout(10000),
          })

          if (!response.ok) {
            await compare(password, DUMMY_PASSWORD)
            return null
          }

          const data = await response.json()

          if (!data.success || !data.user) {
            await compare(password, DUMMY_PASSWORD)
            return null
          }

          let frontendUser = await queries.getUser(email)
          if (frontendUser.length === 0) {
            await queries.createUser(email, "")
            frontendUser = await queries.getUser(email)
          }

          if (frontendUser.length === 0) {
            await compare(password, DUMMY_PASSWORD)
            return null
          }

          const [user] = frontendUser
          const backendMemberId = data.user.member_id || null
          return {
            id: user.id,
            email: email,
            name: (data.user.nickname || email) as string,
            type: "regular" as const,
            memberId: backendMemberId,
          }
        } catch (error) {
          console.error("[Auth] 认证错误:", error)
          return null
        }
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        if (!hasDatabase) {
          console.log("[auth] Creating mock guest user for preview environment")
          return {
            id: `guest-preview-${Date.now()}`,
            email: `guest-${Date.now()}@preview.local`,
            name: "Guest User",
            type: "guest" as const,
            memberId: null,
          }
        }

        try {
          const queries = await getQueries()
          if (!queries) {
            console.log("[auth] Queries not available, creating mock guest")
            return {
              id: `guest-fallback-${Date.now()}`,
              email: `guest-${Date.now()}@fallback.local`,
              name: "Guest User",
              type: "guest" as const,
              memberId: null,
            }
          }

          const [guestUser] = await queries.createGuestUser()
          return {
            id: guestUser.id,
            email: guestUser.email || null,
            name: "Guest",
            type: "guest" as const,
            memberId: null,
          }
        } catch (error) {
          console.error("[auth] Error creating guest user:", error)
          return {
            id: `guest-error-${Date.now()}`,
            email: `guest-${Date.now()}@error.local`,
            name: "Guest User",
            type: "guest" as const,
            memberId: null,
          }
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
        token.memberId = user.memberId || null
      }

      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.type = token.type
        if (token.email) {
          session.user.email = token.email
        }
        if (token.memberId) {
          session.user.memberId = token.memberId
        }
      }

      return session
    },
  },
})
