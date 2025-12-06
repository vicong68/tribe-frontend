export const isProductionEnvironment = process.env.NODE_ENV === "production"
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development"
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.PLAYWRIGHT || process.env.CI_PLAYWRIGHT,
)

// Guest 用户识别：支持旧的 guest-{timestamp} 格式和新的固定 guest-user@tribe.local 格式
export const guestRegex = /^guest-\d+$|^guest-user@tribe\.local$/

export const DUMMY_PASSWORD = "$2a$10$dummypasswordhashforv0preview"
