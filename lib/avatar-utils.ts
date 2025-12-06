/**
 * 头像生成工具函数
 * 为Agent和用户生成基于名称的固化头像样式
 * 使用名称作为种子，确保相同名称总是生成相同的头像
 */

// 简单的头像颜色方案（基于名称生成，确保固化）
const AVATAR_COLORS = [
  { bg: "#3B82F6", text: "#FFFFFF" }, // 蓝色
  { bg: "#10B981", text: "#FFFFFF" }, // 绿色
  { bg: "#F59E0B", text: "#FFFFFF" }, // 橙色
  { bg: "#EF4444", text: "#FFFFFF" }, // 红色
  { bg: "#8B5CF6", text: "#FFFFFF" }, // 紫色
  { bg: "#EC4899", text: "#FFFFFF" }, // 粉色
  { bg: "#06B6D4", text: "#FFFFFF" }, // 青色
  { bg: "#84CC16", text: "#FFFFFF" }, // 黄绿色
];

/**
 * 根据名称生成稳定的颜色索引（确保相同名称总是返回相同颜色）
 */
function getColorIndex(name: string): number {
  if (!name) return 0;
  
  let hash = 0;
  // 使用稳定的哈希算法
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash) % AVATAR_COLORS.length;
}

/**
 * 获取头像颜色（基于名称，确保固化）
 * @param seed 种子值（名称或ID），用于生成稳定的颜色
 */
export function getAvatarColor(seed: string) {
  if (!seed) seed = "default";
  const index = getColorIndex(seed);
  return AVATAR_COLORS[index];
}

/**
 * 获取头像显示文本（取前两个字符）
 * @param name 名称
 */
export function getAvatarText(name: string): string {
  if (!name) return "?";
  
  // 如果是中文，取前一个字符
  if (/[\u4e00-\u9fa5]/.test(name)) {
    return name.slice(0, 1);
  }
  
  // 如果是英文，取前两个字符（大写）
  return name.slice(0, 2).toUpperCase();
}

/**
 * 生成头像URL（使用Vercel头像服务，基于名称生成，确保固化）
 * @param name 名称（用于显示）
 * @param seed 种子值（用于生成稳定的头像URL，优先使用ID，其次使用名称）
 */
export function getAvatarUrl(name: string, seed?: string): string {
  // 使用种子值（ID或名称）生成稳定的头像URL
  const avatarSeed = seed || name || "default";
  return `https://avatar.vercel.sh/${encodeURIComponent(avatarSeed)}`;
}

/**
 * 根据种子值选择图标变体（确保相同种子总是返回相同变体）
 * @param seed 种子值
 * @param variantCount 变体总数
 * @returns 变体索引
 */
function getIconVariant(seed: string, variantCount: number): number {
  if (!seed || variantCount <= 1) return 0;
  
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) % variantCount;
}

/**
 * 为Agent或用户生成完整的头像信息
 * @param name 显示名称
 * @param id 唯一标识（用于生成稳定的头像）
 * @param isAgent 是否为Agent（用于选择图标类型）
 * @returns 头像信息对象
 */
export function getAvatarInfo(name: string, id?: string, isAgent?: boolean) {
  const seed = id || name || "default";
  const iconVariant = getIconVariant(seed, 4); // 4种变体
  
  return {
    url: getAvatarUrl(name, seed),
    text: getAvatarText(name),
    color: getAvatarColor(seed),
    seed, // 保存种子值，用于后续一致性检查
    iconVariant, // 图标变体索引
    isAgent: isAgent ?? false, // 是否为Agent
  };
}

/**
 * 批量预加载头像信息（用于下拉列表等场景）
 * @param items 包含name和id的对象数组
 * @returns 包含头像信息的对象数组
 */
export function preloadAvatars<T extends { name: string; id?: string; type?: "agent" | "user" }>(
  items: T[]
): Array<T & { avatar: ReturnType<typeof getAvatarInfo> }> {
  return items.map((item) => ({
    ...item,
    avatar: getAvatarInfo(item.name, item.id, item.type === "agent"),
  }));
}

/**
 * 判断是否为Agent消息
 * Agent消息：role === "assistant" && communicationType === "user_agent"
 * 注意：远端用户消息也是 role === "assistant"，但 communicationType === "user_user"
 */
export function isAgentMessage(
  role: string,
  communicationType?: string
): boolean {
  // Agent消息：role 是 assistant 且 communicationType 是 user_agent
  return role === "assistant" && communicationType === "user_agent";
}

/**
 * 判断是否为远端用户消息
 * 注意：远端用户消息的 role 应该是 "assistant"（因为对本地用户来说是接收到的消息）
 * 但 communicationType === "user_user" 表示这是用户-用户对话
 */
export function isRemoteUserMessage(
  role: string,
  communicationType?: string
): boolean {
  // 远端用户消息：role 是 assistant（对本地用户来说是接收到的消息）
  // 但 communicationType 是 user_user（表示这是用户-用户对话）
  return role === "assistant" && communicationType === "user_user";
}
