/**
 * IP 地理位置定位工具
 * 使用免费的 IP 定位 API 服务
 */

export interface GeoLocation {
  longitude: number | null;
  latitude: number | null;
  city: string | null;
  country: string | null;
}

/**
 * 从请求中获取客户端 IP 地址
 */
function getClientIP(request: Request): string | null {
  // 尝试从各种头部获取真实 IP
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }

  const cfConnectingIP = request.headers.get("cf-connecting-ip");
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  return null;
}

/**
 * 使用 IP 定位 API 获取地理位置信息
 * 使用免费的 ipapi.co 服务（无需 API key，有速率限制）
 * 备选方案：ip-api.com, ipgeolocation.io 等
 */
async function getLocationFromIP(ip: string): Promise<GeoLocation> {
  try {
    // 使用 ipapi.co（免费，无需 API key，1000 次/天）
    const response = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: {
        "User-Agent": "TribeAgents/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`IP API returned ${response.status}`);
    }

    const data = await response.json();

    // ipapi.co 返回格式
    if (data.error) {
      throw new Error(data.reason || "IP API error");
    }

    return {
      longitude: data.longitude || null,
      latitude: data.latitude || null,
      city: data.city || null,
      country: data.country_name || data.country || null,
    };
  } catch (error) {
    console.warn("Failed to get location from IP:", error);
    // 返回默认值
    return {
      longitude: null,
      latitude: null,
      city: null,
      country: null,
    };
  }
}

/**
 * 获取请求的地理位置信息
 * 优先使用 IP 定位，失败则返回空值
 */
export async function geolocation(request: Request): Promise<GeoLocation> {
  // 如果环境变量禁用了地理位置功能，直接返回空值
  if (process.env.DISABLE_GEOLOCATION === "true") {
    return {
      longitude: null,
      latitude: null,
      city: null,
      country: null,
    };
  }

  const ip = getClientIP(request);

  // 如果没有 IP 地址，返回空值
  if (!ip) {
    return {
      longitude: null,
      latitude: null,
      city: null,
      country: null,
    };
  }

  // 本地 IP 地址，返回空值
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.20.") ||
    ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") ||
    ip.startsWith("172.23.") ||
    ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") ||
    ip.startsWith("172.26.") ||
    ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") ||
    ip.startsWith("172.29.") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.")
  ) {
    return {
      longitude: null,
      latitude: null,
      city: null,
      country: null,
    };
  }

  return await getLocationFromIP(ip);
}
