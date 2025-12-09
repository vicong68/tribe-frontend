import { FileIcon, FileTextIcon, ImageIcon, VideoIcon, MusicIcon, ArchiveIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 根据文件类型获取图标
 */
export function getFileIcon(mimeType: string): LucideIcon {
  if (mimeType.startsWith("image/")) {
    return ImageIcon;
  }
  if (mimeType.startsWith("video/")) {
    return VideoIcon;
  }
  if (mimeType.startsWith("audio/")) {
    return MusicIcon;
  }
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("word") ||
    mimeType.includes("excel") ||
    mimeType.includes("powerpoint") ||
    mimeType.includes("text") ||
    mimeType.includes("markdown")
  ) {
    return FileTextIcon;
  }
  if (mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("tar")) {
    return ArchiveIcon;
  }
  return FileIcon;
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * 根据扩展名判断文件类型
 */
export function getMimeTypeFromExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    md: "text/markdown",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
  };
  return mimeTypes[extension] || "application/octet-stream";
}

