export type ErrorType =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "offline";

export type Surface =
  | "chat"
  | "auth"
  | "api"
  | "stream"
  | "database"
  | "history"
  | "vote"
  | "document"
  | "suggestions"

export type ErrorCode = `${ErrorType}:${Surface}`;

export type ErrorVisibility = "response" | "log" | "none";

export const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  database: "log",
  chat: "response",
  auth: "response",
  stream: "response",
  api: "response",
  history: "response",
  vote: "response",
  document: "response",
  suggestions: "response",
};

export class ChatSDKError extends Error {
  type: ErrorType;
  surface: Surface;
  statusCode: number;

  constructor(errorCode: ErrorCode, cause?: string) {
    super();

    const [type, surface] = errorCode.split(":");

    this.type = type as ErrorType;
    this.cause = cause;
    this.surface = surface as Surface;
    this.message = getMessageByErrorCode(errorCode);
    this.statusCode = getStatusCodeByType(this.type);
  }

  toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    if (visibility === "log") {
      console.error({
        code,
        message,
        cause,
      });

      return Response.json(
        { code: "", message: "出现了错误。请稍后再试。" },
        { status: statusCode }
      );
    }

    return Response.json({ code, message, cause }, { status: statusCode });
  }
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  if (errorCode.includes("database")) {
    return "执行数据库查询时发生错误。";
  }

  switch (errorCode) {
    case "bad_request:api":
      return "请求无法处理。请检查您的输入并重试。";


    case "unauthorized:auth":
      return "您需要先登录才能继续。";
    case "forbidden:auth":
      return "您的账号无权访问此功能。";

    case "rate_limit:chat":
      return "您已超过今日最大消息数。请稍后再试。";
    case "not_found:chat":
      return "未找到请求的对话。请检查对话 ID 并重试。";
    case "forbidden:chat":
      return "此对话属于其他用户。请检查对话 ID 并重试。";
    case "unauthorized:chat":
      return "您需要登录才能查看此对话。请登录后重试。";
    case "offline:chat":
      return "发送消息时遇到问题。请检查您的网络连接并重试。";

    case "not_found:document":
      return "未找到请求的文档。请检查文档 ID 并重试。";
    case "forbidden:document":
      return "此文档属于其他用户。请检查文档 ID 并重试。";
    case "unauthorized:document":
      return "您需要登录才能查看此文档。请登录后重试。";
    case "bad_request:document":
      return "创建或更新文档的请求无效。请检查您的输入并重试。";

    default:
      return "出现了错误。请稍后再试。";
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limit":
      return 429;
    case "offline":
      return 503;
    default:
      return 500;
  }
}
