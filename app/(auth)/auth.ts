import NextAuth, { type DefaultSession } from "next-auth"
import type { DefaultJWT } from "next-auth/jwt"
import Credentials from "next-auth/providers/credentials"

let compare: typeof import("bcrypt-ts").compare
let createGuestUser: typeof import("@/lib/db/queries").createGuestUser
let getUser: typeof import("@/lib/db/queries").getUser
let createUser: typeof import("@/lib/db/queries").createUser
let DUMMY_PASSWORD: string

// Check if we're in a proper server environment with database access
const isServerEnvironment = typeof process !== "undefined" && process.env.POSTGRES_URL

if (isServerEnvironment) {
  try {
    const bcrypt = await import("bcrypt-ts")
    compare = bcrypt.compare
    const queries = await import("@/lib/db/queries")
    createGuestUser = queries.createGuestUser
    getUser = queries.getUser
    createUser = queries.createUser
    const constants = await import("@/lib/constants")
    DUMMY_PASSWORD = constants.DUMMY_PASSWORD
  } catch (e) {
    console.warn("[auth] Failed to load server modules:", e)
  }
}

// Fallback implementations for v0 preview
const fallbackCompare = async () => false
const fallbackDummyPassword = ""

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
        if (!isServerEnvironment || !compare) {
          console.warn("[auth] Server modules not available, returning null")
          return null
        }

        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = String(credentials.email)
        const password = String(credentials.password)

        try {
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
            await compare(password, DUMMY_PASSWORD || fallbackDummyPassword)
            return null
          }

          const data = await response.json()

          if (!data.success || !data.user) {
            await compare(password, DUMMY_PASSWORD || fallbackDummyPassword)
            return null
          }

          let frontendUser = await getUser(email)
          if (frontendUser.length === 0) {
            await createUser(email, "")
            frontendUser = await getUser(email)
          }

          if (frontendUser.length === 0) {
            await compare(password, DUMMY_PASSWORD || fallbackDummyPassword)
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
          await (compare || fallbackCompare)(password, DUMMY_PASSWORD || fallbackDummyPassword)
          return null
        }
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        if (!isServerEnvironment || !createGuestUser) {
          console.warn("[auth] Creating mock guest user for v0 preview")
          return {
            id: `guest-${Date.now()}`,
            email: null,
            name: "Guest",
            type: "guest" as const,
            memberId: null,
          }
        }

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
