/**
 * Session ID 统一生成工具
 * 确保对话记忆隔离，采用不同对话双方（但 session_id 中双方前后顺序一致）确定的 session_id
 * 
 * 格式：session_{participant1}_{participant2}
 * 规则：participant1 和 participant2 按字母序排序，确保顺序一致
 */

/**
 * 生成统一的 session_id
 * 
 * @param participant1 参与者1（通常是用户ID）
 * @param participant2 参与者2（通常是 Agent 名称或用户ID）
 * @returns 格式化的 session_id: session_{participant1}_{participant2}
 * 
 * @example
 * generateSessionId("user123", "司仪") // "session_司仪_user123"
 * generateSessionId("user123", "user456") // "session_user123_user456"
 * generateSessionId("user456", "user123") // "session_user123_user456" (顺序一致)
 */
export function generateSessionId(
  participant1: string,
  participant2: string
): string {
  // 按字母序排序，确保顺序一致
  const [p1, p2] = [participant1, participant2].sort();
  return `session_${p1}_${p2}`;
}

/**
 * 从 session_id 解析参与者
 * 
 * @param sessionId session_id 字符串
 * @returns [participant1, participant2] 或 null（如果格式不正确）
 * 
 * @example
 * parseSessionId("session_司仪_user123") // ["司仪", "user123"]
 * parseSessionId("session_user123_user456") // ["user123", "user456"]
 */
export function parseSessionId(
  sessionId: string
): [string, string] | null {
  if (!sessionId.startsWith("session_")) {
    return null;
  }
  
  // 移除 "session_" 前缀
  const content = sessionId.substring(8);
  
  // 找到第一个下划线的位置（分隔两个参与者）
  const firstUnderscoreIndex = content.indexOf("_");
  if (firstUnderscoreIndex === -1 || firstUnderscoreIndex === 0) {
    return null;
  }
  
  // 提取两个参与者
  const participant1 = content.substring(0, firstUnderscoreIndex);
  const participant2 = content.substring(firstUnderscoreIndex + 1);
  
  if (!participant1 || !participant2) {
    return null;
  }
  
  return [participant1, participant2];
}

/**
 * 验证 session_id 格式是否正确
 * 
 * @param sessionId session_id 字符串
 * @returns 是否为有效格式
 */
export function isValidSessionId(sessionId: string): boolean {
  return parseSessionId(sessionId) !== null;
}
