/**
 * 智能体和用户列表预加载组件
 * ✅ 性能优化：在页面加载时预加载智能体列表，提升用户体验
 * 使用 React 18+ 的 Suspense 和流式渲染特性
 */
"use client";

import { useEffect } from "react";
import { useAgents } from "./models-client";

/**
 * 智能体预加载组件
 * 在页面加载时立即预加载智能体列表，确保快速显示
 */
export function AgentsPreloader() {
  // ✅ 性能优化：在页面加载时立即预加载智能体列表
  // 使用 useAgents hook，利用 SWR 的全局缓存
  const { models, loading } = useAgents();

  useEffect(() => {
    // 预加载完成后的处理（可选）
    if (!loading && models.length > 0) {
      if (process.env.NODE_ENV === "development") {
        console.log(`[AgentsPreloader] ✅ 智能体列表预加载完成，共 ${models.length} 个智能体`);
      }
    }
  }, [loading, models]);

  // 此组件不渲染任何内容，仅用于预加载
  return null;
}

