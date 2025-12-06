"use client"

import { SessionProvider, useSession } from "next-auth/react"
import { createContext, useContext, type ReactNode } from "react"

// Mock session for v0 preview environment
const mockSession = {
  user: {
    id: "preview-guest-user",
    email: "guest@preview.local",
    name: "Preview Guest",
  },
  expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
}

const MockSessionContext = createContext<any>(null)

// Check if we're in v0 preview environment (no database connection)
const isPreviewEnvironment = typeof window !== "undefined" && !process.env.NEXT_PUBLIC_POSTGRES_URL

function MockSessionProvider({ children }: { children: ReactNode }) {
  return <MockSessionContext.Provider value={mockSession}>{children}</MockSessionContext.Provider>
}

export function PreviewSessionProvider({ children }: { children: ReactNode }) {
  if (isPreviewEnvironment) {
    return <MockSessionProvider>{children}</MockSessionProvider>
  }

  // In production with database, use real NextAuth
  return <SessionProvider>{children}</SessionProvider>
}

// Export a hook that works with both mock and real sessions
export function usePreviewSession() {
  const mockContext = useContext(MockSessionContext)
  const realSession = useSession()

  // Return mock session in preview environment
  if (isPreviewEnvironment && mockContext) {
    return {
      data: mockContext,
      status: "authenticated" as const,
      update: async () => mockContext,
    }
  }

  // Return real NextAuth session in production
  return realSession
}
