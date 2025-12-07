/**
 * 实体信息缓存（Agent/用户）
 * 使用内存缓存减少重复API调用，提升消息创建性能
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }
    // 将访问的项移到末尾（最近使用）
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最旧的项（第一个）
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

class EntityCache {
  private agentCache: LRUCache<string, CacheEntry<string>>;
  private userCache: LRUCache<string, CacheEntry<string>>;
  private agentListCache: CacheEntry<any[]> | null = null;
  private userListCache: CacheEntry<any[]> | null = null;

  // Agent信息缓存TTL：1小时
  private readonly AGENT_CACHE_TTL = 60 * 60 * 1000;
  // 用户信息缓存TTL：5分钟（用户信息变化更频繁）
  private readonly USER_CACHE_TTL = 5 * 60 * 1000;
  // 列表缓存TTL：1分钟
  private readonly LIST_CACHE_TTL = 60 * 1000;

  constructor() {
    // LRU缓存大小：Agent 100条，用户 200条
    this.agentCache = new LRUCache(100);
    this.userCache = new LRUCache(200);
  }

  /**
   * 获取Agent显示名称（带缓存）
   */
  getAgentName(agentId: string): string | null {
    const entry = this.agentCache.get(agentId);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data;
    }
    return null;
  }

  /**
   * 缓存Agent显示名称
   */
  setAgentName(agentId: string, displayName: string): void {
    this.agentCache.set(agentId, {
      data: displayName,
      expiresAt: Date.now() + this.AGENT_CACHE_TTL,
    });
  }

  /**
   * 获取用户显示名称（带缓存）
   */
  getUserName(userId: string): string | null {
    const entry = this.userCache.get(userId);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data;
    }
    return null;
  }

  /**
   * 缓存用户显示名称
   */
  setUserName(userId: string, displayName: string): void {
    this.userCache.set(userId, {
      data: displayName,
      expiresAt: Date.now() + this.USER_CACHE_TTL,
    });
  }

  /**
   * 获取Agent列表缓存
   */
  getAgentList(): any[] | null {
    if (
      this.agentListCache &&
      this.agentListCache.expiresAt > Date.now()
    ) {
      return this.agentListCache.data;
    }
    return null;
  }

  /**
   * 缓存Agent列表
   */
  setAgentList(agents: any[]): void {
    this.agentListCache = {
      data: agents,
      expiresAt: Date.now() + this.LIST_CACHE_TTL,
    };
    // 同时更新单个Agent缓存
    agents.forEach((agent) => {
      if (agent.id && agent.display_name) {
        this.setAgentName(agent.id, agent.display_name);
      }
    });
  }

  /**
   * 获取用户列表缓存
   */
  getUserList(): any[] | null {
    if (
      this.userListCache &&
      this.userListCache.expiresAt > Date.now()
    ) {
      return this.userListCache.data;
    }
    return null;
  }

  /**
   * 缓存用户列表
   */
  setUserList(users: any[]): void {
    this.userListCache = {
      data: users,
      expiresAt: Date.now() + this.LIST_CACHE_TTL,
    };
    // 同时更新单个用户缓存
    users.forEach((user) => {
      const userId = user.id?.replace(/^user::/, "") || user.member_id;
      const displayName = user.display_name || user.nickname;
      if (userId && displayName) {
        this.setUserName(userId, displayName);
      }
    });
  }

  /**
   * 清除Agent缓存
   */
  clearAgentCache(): void {
    this.agentCache.clear();
    this.agentListCache = null;
  }

  /**
   * 清除用户缓存
   */
  clearUserCache(): void {
    this.userCache.clear();
    this.userListCache = null;
  }

  /**
   * 清除所有缓存
   */
  clearAll(): void {
    this.clearAgentCache();
    this.clearUserCache();
  }
}

// 全局单例
export const entityCache = new EntityCache();

