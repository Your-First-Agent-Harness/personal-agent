import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  StdioMcpClient,
  type StdioMcpClientOptions,
} from "../src/adapters/mcp-stdio-client.ts";

const fixturePath = fileURLToPath(
  new URL("./fixtures/mcp-stdio-server.ts", import.meta.url),
);
const clients = new Set<StdioMcpClient>();

function createClient(
  scenario = "basic",
  overrides: Partial<StdioMcpClientOptions> = {},
): StdioMcpClient {
  const client = new StdioMcpClient({
    command: process.execPath,
    args: [fixturePath, scenario],
    requestTimeoutMs: 1_000,
    closeTimeoutMs: 100,
    ...overrides,
  });
  clients.add(client);
  return client;
}

afterEach(async () => {
  await Promise.all([...clients].map(async (client) => client.close()));
  clients.clear();
});

describe("D035 MCP stdio Client", () => {
  it("先 initialize，校验 2025-11-25 响应，再发送 initialized 完成握手", async () => {
    const client = createClient();

    const initialized = await client.connect();

    expect(initialized).toEqual({
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "d035-basic-fixture", version: "1.0.0" },
    });
    await expect(client.listTools()).resolves.toMatchObject({
      nextCursor: "page-2",
      tools: [{ name: "echo" }],
    });
  });

  it("callTool 保留 content、structuredContent 和 isError，不改写工具结果", async () => {
    const client = createClient();
    await client.connect();

    await expect(
      client.callTool("echo", { text: "你好", count: 2 }),
    ).resolves.toEqual({
      content: [{ type: "text", text: '{"text":"你好","count":2}' }],
      structuredContent: { echo: { text: "你好", count: 2 } },
      isError: false,
    });
    await expect(client.callTool("fail")).resolves.toEqual({
      content: [{ type: "text", text: "tool execution failed" }],
      isError: true,
    });
  });

  it("JSON-RPC error 以独立 McpRpcError 拒绝并保留 code/data", async () => {
    const client = createClient();
    await client.connect();

    await expect(client.callTool("rpc-error")).rejects.toMatchObject({
      name: "McpRpcError",
      code: "RPC_ERROR",
      rpcCode: -32602,
      message: "unknown tool arguments",
      data: { field: "text" },
    });
  });

  it("并发请求按 id 配对，即使 slow/fast 响应乱序也不串单", async () => {
    const client = createClient();
    await client.connect();

    const [slow, fast] = await Promise.all([
      client.callTool("slow"),
      client.callTool("fast"),
    ]);

    expect(slow.structuredContent).toEqual({ name: "slow" });
    expect(fast.structuredContent).toEqual({ name: "fast" });
  });

  it("listAllTools 原样跟随 nextCursor 直到末页", async () => {
    const client = createClient();
    await client.connect();

    const tools = await client.listAllTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "echo",
      "slow",
      "fast",
      "fail",
      "rpc-error",
      "hang",
      "inspect",
    ]);
  });

  it("分页游标循环时在配置上限处明确失败，避免死循环", async () => {
    const client = createClient("cycle", { maxToolListPages: 2 });
    await client.connect();

    await expect(client.listAllTools()).rejects.toMatchObject({
      code: "PAGINATION_LIMIT",
    });
  });

  it("Server 未声明 tools 时在本地拒绝列工具和调用", async () => {
    const client = createClient("no-tools");
    await client.connect();

    await expect(client.listTools()).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
    });
    await expect(client.callTool("echo")).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
    });
  });

  it("协议版本不匹配时拒绝连接，且不发送 initialized", async () => {
    const client = createClient("wrong-version");

    await expect(client.connect()).rejects.toMatchObject({
      code: "VERSION_UNSUPPORTED",
    });
    expect(client.getStderr()).not.toContain("UNEXPECTED_INITIALIZED");
  });

  it("initialize result 缺少必要字段时明确报协议错误", async () => {
    const client = createClient("bad-initialize");

    await expect(client.connect()).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
  });

  it("请求超时会清理 pending、发送 cancelled，后续请求仍可用", async () => {
    const client = createClient("basic", { requestTimeoutMs: 100 });
    await client.connect();

    await expect(client.callTool("hang")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    const inspection = await client.callTool("inspect");
    expect(inspection.structuredContent).toMatchObject({
      cancellations: [{ reason: "timeout" }],
    });
  }, 500);

  it("AbortSignal 会清理 pending、发送 cancelled，后续请求仍可用", async () => {
    const client = createClient();
    await client.connect();
    const controller = new AbortController();
    const pending = client.callTool("hang", {}, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    const inspection = await client.callTool("inspect");
    expect(inspection.structuredContent).toMatchObject({
      cancellations: [{ reason: "aborted" }],
    });
  }, 500);

  it("stdout 非 JSON 帧使当前请求明确失败且不悬挂", async () => {
    const client = createClient("bad-frame");
    await client.connect();

    await expect(client.listTools()).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
  });

  it("未知响应 id 是协议错误，不会冒充另一个请求的响应", async () => {
    const client = createClient("unknown-id");
    await client.connect();

    await expect(client.listTools()).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
  });

  it("Server 在请求过程中退出会拒绝 pending Promise", async () => {
    const client = createClient("exit-on-list");
    await client.connect();

    await expect(client.listTools()).rejects.toMatchObject({
      code: "TRANSPORT_ERROR",
    });
  });

  it("Server 在 initialize 前退出会拒绝 connect", async () => {
    const client = createClient("exit-on-initialize");

    await expect(client.connect()).rejects.toMatchObject({
      code: "TRANSPORT_ERROR",
    });
  });

  it("安全回应 ping，对未支持的 Server 请求返回 Method not found", async () => {
    const client = createClient("server-requests");
    await client.connect();

    const inspection = await client.callTool("inspect");

    expect(inspection.structuredContent).toMatchObject({
      serverResponses: [
        { id: "server-ping", result: {} },
        {
          id: "server-unsupported",
          error: { code: -32601, message: "Method not found" },
        },
      ],
    });
  });

  it("取消和 list_changed 通知只观察、不回复，也不破坏响应配对", async () => {
    const notifications: string[] = [];
    const client = createClient("notifications", {
      onNotification: (notification) => notifications.push(notification.method),
    });
    await client.connect();

    await expect(client.listTools()).resolves.toMatchObject({
      nextCursor: "page-2",
    });
    expect(notifications).toEqual([
      "notifications/cancelled",
      "notifications/tools/list_changed",
    ]);
  });

  it("重复 close 安全，stderr 只保留有界尾部，关闭后操作明确失败", async () => {
    const client = createClient("basic", { maxStderrChars: 12 });
    await client.connect();

    await Promise.all([client.close(), client.close()]);
    await client.close();

    expect(client.getStderr().length).toBeLessThanOrEqual(12);
    await expect(client.listTools()).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("可执行文件不存在时 connect 失败而不是等待 exit 悬挂", async () => {
    const client = createClient("basic", {
      command: "/definitely/missing/d035-mcp-server",
      args: [],
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: "TRANSPORT_ERROR",
    });
  }, 500);

  it("Server 忽略 EOF 和 SIGTERM 时 close 升级 SIGKILL，且不悬挂", async () => {
    const client = createClient("ignore-close", { closeTimeoutMs: 30 });
    await client.connect();
    clients.delete(client);

    const outcome = await Promise.race([
      client.close().then(() => "closed" as const),
      new Promise<"still-running">((resolve) =>
        setTimeout(() => resolve("still-running"), 200),
      ),
    ]);
    if (outcome === "still-running") {
      const pid = Number(client.getStderr().match(/fixture:pid=(\d+)/)?.[1]);
      process.kill(pid, "SIGKILL");
      await client.close();
    }

    expect(outcome).toBe("closed");
  }, 500);
});
