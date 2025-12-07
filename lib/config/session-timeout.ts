/**
 * 会话超时配置
 */
export const SESSION_TIMEOUT_CONFIG = {
  // 不活跃超时时间（毫秒）
  INACTIVITY_TIMEOUT: 45 * 60 * 1000, // 45分钟

  // 心跳发送间隔（毫秒）
  HEARTBEAT_INTERVAL: 5 * 60 * 1000, // 5分钟

  // 会话检查间隔（毫秒）
  CHECK_INTERVAL: 60 * 1000, // 1分钟

  // 活动检测防抖时间（毫秒）
  ACTIVITY_DEBOUNCE: 1000, // 1秒
};

