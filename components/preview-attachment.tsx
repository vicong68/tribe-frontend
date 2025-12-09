import Image from "next/image";
import type { Attachment } from "@/lib/types";
import { Loader } from "./elements/loader";
import { CrossSmallIcon, FileIcon, ImageIcon, DownloadIcon } from "./icons";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

/**
 * 获取文件类型信息（极简风格：使用图标组件而非emoji）
 */
function getFileTypeInfo(contentType?: string, filename?: string) {
  const type = contentType?.toLowerCase() || "";
  const ext = filename?.split(".").pop()?.toLowerCase() || "";

  // 图片类型
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) {
    return { 
      icon: ImageIcon, 
      color: "text-muted-foreground", 
      bgColor: "bg-muted" 
    };
  }

  // 默认文件类型（使用FileIcon）
  return { 
    icon: FileIcon, 
    color: "text-muted-foreground", 
    bgColor: "bg-muted" 
  };
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
  onDownload,
  isInMessage = false, // 是否在消息中显示（支持下载）
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
  onDownload?: () => void;
  isInMessage?: boolean; // 消息中的附件支持下载
}) => {
  const { name, url, contentType, size } = attachment;
  const isImage = contentType?.startsWith("image/");
  const fileTypeInfo = getFileTypeInfo(contentType, name);
  const fileSizeStr = formatFileSize(size);

  const IconComponent = fileTypeInfo.icon;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted",
        isInMessage ? "w-full max-w-xs" : "size-16",
        isImage && !isInMessage && "size-16"
      )}
      data-testid="input-attachment-preview"
    >
      {isImage ? (
        // 图片类型：显示缩略图（极简风格）
        <Image
          alt={name ?? "An image attachment"}
          className="size-full object-cover"
          height={isInMessage ? 200 : 64}
          src={url}
          width={isInMessage ? 300 : 64}
        />
      ) : (
        // 其他文件类型：显示文件metadata占位（极简风格）
        <div
          className={cn(
            "flex size-full flex-col items-center justify-center gap-1.5 p-3",
            fileTypeInfo.bgColor
          )}
        >
          <div className={cn(fileTypeInfo.color)}>
            <IconComponent size={isInMessage ? 24 : 20} />
          </div>
          {isInMessage && (
            <>
              <div className="truncate w-full text-center text-xs font-medium text-foreground px-1">
                {name}
              </div>
              {fileSizeStr && (
                <div className="text-[10px] text-muted-foreground">{fileSizeStr}</div>
              )}
            </>
          )}
        </div>
      )}

      {isUploading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <Loader size={16} />
        </div>
      )}

      {/* 移除按钮（仅在输入框预览时显示，极简风格） */}
      {onRemove && !isUploading && !isInMessage && (
        <Button
          className="absolute top-1 right-1 size-5 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100 bg-destructive/90 hover:bg-destructive"
          onClick={onRemove}
          size="sm"
          variant="ghost"
          aria-label="移除文件"
        >
          <CrossSmallIcon size={10} />
        </Button>
      )}

      {/* 下载按钮（仅在消息中显示，极简风格） */}
      {onDownload && !isUploading && isInMessage && (
        <Button
          className="absolute top-1.5 right-1.5 size-7 rounded-md p-0 opacity-0 transition-opacity group-hover:opacity-100 bg-background/90 hover:bg-background border"
          onClick={onDownload}
          size="sm"
          variant="ghost"
          title="下载文件"
          aria-label="下载文件"
        >
          <DownloadIcon size={14} />
        </Button>
      )}

      {/* 文件名显示（输入框预览时显示在底部，极简风格） */}
      {!isInMessage && (
        <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white">
          {name}
        </div>
      )}
    </div>
  );
};
