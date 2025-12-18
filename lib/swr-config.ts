/**
 * 统一的 SWR 配置
 * 最佳实践：统一配置，减少重复代码，确保数据一致性
 */

export const swrConfig = {
  // 数据获取配置
  revalidateOnMount: true,        // 启动时强制刷新，不使用缓存
  revalidateOnFocus: true,        // 窗口聚焦时重新验证，确保数据最新
  revalidateOnReconnect: true,    // 重连时重新验证
  dedupingInterval: 1000,         // 1秒内去重相同请求
  refreshInterval: 0,             // 不自动刷新（按需刷新）
  
  // 错误处理配置
  shouldRetryOnError: true,       // 自动重试
  errorRetryCount: 2,             // 最多重试2次
  errorRetryInterval: 1000,       // 重试间隔1秒
};

/**
 * 统一的 fetch 配置（用于 SWR fetcher）
 */
export const fetchConfig = {
  cache: "no-store" as RequestCache,
  headers: {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  },
};

