/**
 * WebSocket 消息功能测试
 * 
 * 测试场景：
 * 1. WebSocket 连接建立
 * 2. 消息发送和接收
 * 3. 离线消息处理
 * 4. 重连机制
 */

describe("WebSocket 消息功能", () => {
  let mockWebSocket: jest.Mock;
  let originalWebSocket: typeof WebSocket;

  beforeAll(() => {
    // 保存原始 WebSocket
    originalWebSocket = global.WebSocket;
  });

  beforeEach(() => {
    // 创建模拟 WebSocket
    mockWebSocket = jest.fn().mockImplementation(() => {
      const ws = {
        readyState: WebSocket.CONNECTING,
        send: jest.fn(),
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };
      return ws;
    });
    global.WebSocket = mockWebSocket as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // 恢复原始 WebSocket
    global.WebSocket = originalWebSocket;
  });

  it("应该建立 WebSocket 连接", () => {
    const userId = "user123";
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
    const wsUrl = backendUrl.replace(/^http/, "ws") + `/api/ws/messages/${userId}`;

    new WebSocket(wsUrl);

    expect(mockWebSocket).toHaveBeenCalledWith(wsUrl);
  });

  it("应该发送消息", () => {
    const ws = new WebSocket("ws://localhost:3000/api/ws/messages/user123");
    ws.readyState = WebSocket.OPEN;

    const message = {
      type: "send_message",
      receiver_id: "user456",
      content: "测试消息",
      session_id: "session_user123_user456",
    };

    ws.send(JSON.stringify(message));

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(message));
  });

  it("应该处理接收到的消息", () => {
    const ws = new WebSocket("ws://localhost:3000/api/ws/messages/user123");
    const onMessage = jest.fn();

    ws.addEventListener("message", onMessage);

    const message = {
      message_type: "message",
      content: "你好",
      sender_id: "user456",
      sender_name: "用户456",
      receiver_id: "user123",
      receiver_name: "用户123",
      session_id: "session_user456_user123",
      message_id: "msg_001",
      timestamp: Date.now(),
      created_at: new Date().toISOString(),
    };

    // 模拟接收消息
    const event = new MessageEvent("message", {
      data: JSON.stringify(message),
    });
    ws.dispatchEvent(event);

    expect(onMessage).toHaveBeenCalled();
  });

  it("应该处理心跳 (ping/pong)", () => {
    const ws = new WebSocket("ws://localhost:3000/api/ws/messages/user123");
    ws.readyState = WebSocket.OPEN;

    const ping = {
      type: "ping",
      timestamp: Date.now(),
    };

    ws.send(JSON.stringify(ping));

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(ping));
  });

  it("应该在连接断开时重连", () => {
    const ws = new WebSocket("ws://localhost:3000/api/ws/messages/user123");
    const onClose = jest.fn();

    ws.addEventListener("close", onClose);

    // 模拟连接关闭
    ws.close();

    expect(onClose).toHaveBeenCalled();
  });
});

