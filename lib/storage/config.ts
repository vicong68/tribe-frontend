import "server-only";

/**
 * 文件上传配置
 * 符合 Vercel AI Chatbot 最佳实践：配置化管理
 */
export interface FileUploadConfig {
  // 文件大小限制（字节）
  maxFileSize: number;
  // 允许的文件类型（MIME types）
  allowedMimeTypes: string[];
  // 是否启用文件压缩
  enableCompression: boolean;
  // 压缩质量（0-100，仅对图片有效）
  compressionQuality: number;
}

/**
 * 默认文件上传配置
 */
const DEFAULT_CONFIG: FileUploadConfig = {
  maxFileSize: 5 * 1024 * 1024, // 5MB（可根据需要调整）
  allowedMimeTypes: [
    // 图片类型
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    // 可以根据需要扩展其他类型
    // "application/pdf",
    // "text/plain",
    // "application/msword",
    // "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  enableCompression: false, // 默认关闭（可根据需要启用）
  compressionQuality: 80, // 压缩质量（0-100）
};

/**
 * 从环境变量读取配置
 */
function getConfigFromEnv(): Partial<FileUploadConfig> {
  const config: Partial<FileUploadConfig> = {};

  // 读取文件大小限制（MB）
  const maxFileSizeMB = process.env.MAX_FILE_SIZE_MB;
  if (maxFileSizeMB) {
    const sizeMB = Number.parseInt(maxFileSizeMB, 10);
    if (!Number.isNaN(sizeMB) && sizeMB > 0) {
      config.maxFileSize = sizeMB * 1024 * 1024;
    }
  }

  // 读取允许的文件类型（逗号分隔）
  const allowedTypes = process.env.ALLOWED_FILE_TYPES;
  if (allowedTypes) {
    config.allowedMimeTypes = allowedTypes.split(",").map((type) => type.trim());
  }

  // 读取压缩配置
  const enableCompression = process.env.ENABLE_FILE_COMPRESSION;
  if (enableCompression === "true") {
    config.enableCompression = true;
  }

  const compressionQuality = process.env.FILE_COMPRESSION_QUALITY;
  if (compressionQuality) {
    const quality = Number.parseInt(compressionQuality, 10);
    if (!Number.isNaN(quality) && quality >= 0 && quality <= 100) {
      config.compressionQuality = quality;
    }
  }

  return config;
}

/**
 * 获取文件上传配置
 */
export function getFileUploadConfig(): FileUploadConfig {
  const envConfig = getConfigFromEnv();
  return {
    ...DEFAULT_CONFIG,
    ...envConfig,
  };
}

/**
 * MinIO 配置验证
 */
export interface MinIOConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  publicUrl: string;
}

/**
 * 验证 MinIO 环境变量
 */
export function validateMinIOConfig(): MinIOConfig {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;

  if (!endpoint) {
    throw new Error("MINIO_ENDPOINT environment variable is required");
  }

  if (!accessKey) {
    throw new Error("MINIO_ACCESS_KEY environment variable is required");
  }

  if (!secretKey) {
    throw new Error("MINIO_SECRET_KEY environment variable is required");
  }

  // 验证 endpoint URL 格式
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`Invalid MINIO_ENDPOINT format: ${endpoint}`);
  }

  return {
    endpoint,
    accessKey,
    secretKey,
    region: process.env.MINIO_REGION || "us-east-1",
    bucket: process.env.MINIO_BUCKET || "tribe-files",
    publicUrl: process.env.MINIO_PUBLIC_URL || endpoint,
  };
}
