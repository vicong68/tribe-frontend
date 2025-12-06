import { generateId } from "ai"

const isServerEnvironment = typeof window === "undefined" && typeof process !== "undefined"

let bcryptModule: {
  genSaltSync: (rounds: number) => string
  hashSync: (password: string, salt: string) => string
} | null = null

// Only import bcrypt on the server
if (isServerEnvironment) {
  try {
    // Dynamic import for server-only
    bcryptModule = require("bcrypt-ts")
  } catch {
    bcryptModule = null
  }
}

export function generateHashedPassword(password: string) {
  if (!bcryptModule) {
    // Simple hash fallback for v0 preview (NOT secure for production)
    return `$2a$10$preview${Buffer.from(password).toString("base64").slice(0, 22)}`
  }

  const salt = bcryptModule.genSaltSync(10)
  const hash = bcryptModule.hashSync(password, salt)
  return hash
}

export function generateDummyPassword() {
  const password = generateId()
  const hashedPassword = generateHashedPassword(password)
  return hashedPassword
}
