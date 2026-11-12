import { createInterface } from "node:readline";

// 仅供确定性单元测试使用；这不是 D035 的真实外部 Server 验证。
type JsonObject = Record<string, unknown>;

const scenario = process.argv[2] ?? "basic";
let initialized = false;
let requestSeen = false;
const cancellations: JsonObject[] = [];
const serverResponses: JsonObject[] = [];

process.stderr.write(`fixture:${scenario}:ready\n`);
if (scenario === "ignore-close") {
  process.stderr.write(`fixture:pid=${process.pid}\n`);
  process.on("SIGTERM", () =>
    process.stderr.write("fixture:SIGTERM ignored\n"),
  );
  setInterval(() => undefined, 1_000);
}

function send(message: JsonObject): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: unknown, value: JsonObject): void {
  send({ jsonrpc: "2.0", id, result: value });
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
): void {
  send({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function initialize(id: unknown): void {
  requestSeen = true;
  if (scenario === "exit-on-initialize") {
    process.exit(19);
  }
  if (scenario === "bad-initialize") {
    result(id, { protocolVersion: "2025-11-25" });
    return;
  }
  result(id, {
    protocolVersion: scenario === "wrong-version" ? "2024-11-05" : "2025-11-25",
    capabilities:
      scenario === "no-tools" ? {} : { tools: { listChanged: true } },
    serverInfo: { name: `d035-${scenario}-fixture`, version: "1.0.0" },
  });
}

const tools: readonly JsonObject[] = [
  {
    name: "echo",
    description: "返回传入参数",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  { name: "slow", inputSchema: { type: "object" } },
  { name: "fast", inputSchema: { type: "object" } },
  { name: "fail", inputSchema: { type: "object" } },
  { name: "rpc-error", inputSchema: { type: "object" } },
  { name: "hang", inputSchema: { type: "object" } },
  { name: "inspect", inputSchema: { type: "object" } },
];

function listTools(id: unknown, params: JsonObject | undefined): void {
  if (!initialized) {
    rpcError(id, -32000, "tools/list arrived before notifications/initialized");
    return;
  }
  if (scenario === "bad-frame") {
    process.stdout.write("this is not json\n");
    return;
  }
  if (scenario === "unknown-id") {
    result(999_999, { tools });
    return;
  }
  if (scenario === "exit-on-list") {
    process.exit(23);
  }
  if (scenario === "notifications") {
    send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "remote-request", reason: "fixture done" },
    });
    send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }
  if (scenario === "cycle") {
    result(id, { tools: [tools[0]], nextCursor: "repeat" });
    return;
  }
  const cursor = params?.["cursor"];
  if (cursor === undefined) {
    result(id, { tools: [tools[0]], nextCursor: "page-2" });
  } else if (cursor === "page-2") {
    result(id, { tools: tools.slice(1) });
  } else {
    rpcError(id, -32602, "invalid cursor", { cursor });
  }
}

function callTool(id: unknown, params: JsonObject | undefined): void {
  if (!initialized) {
    rpcError(id, -32000, "tools/call arrived before notifications/initialized");
    return;
  }
  const name = params?.["name"];
  const args = params?.["arguments"];
  if (
    scenario === "server-requests" &&
    name === "inspect" &&
    serverResponses.length < 2
  ) {
    setTimeout(() => callTool(id, params), 5);
    return;
  }
  if (name === "rpc-error") {
    rpcError(id, -32602, "unknown tool arguments", { field: "text" });
    return;
  }
  if (name === "fail") {
    result(id, {
      content: [{ type: "text", text: "tool execution failed" }],
      isError: true,
    });
    return;
  }
  if (name === "hang") {
    return;
  }
  if (name === "slow" || name === "fast") {
    setTimeout(
      () => {
        result(id, {
          content: [{ type: "text", text: String(name) }],
          structuredContent: { name },
        });
      },
      name === "slow" ? 50 : 0,
    );
    return;
  }
  if (name === "inspect") {
    result(id, {
      content: [{ type: "text", text: "inspect" }],
      structuredContent: { cancellations, serverResponses },
    });
    return;
  }
  if (name === "echo") {
    result(id, {
      content: [{ type: "text", text: JSON.stringify(args) }],
      structuredContent: { echo: args },
      isError: false,
    });
    return;
  }
  rpcError(id, -32602, "unknown tool");
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line) as JsonObject;
  const method = message["method"];
  const id = message["id"];

  if (typeof method === "string") {
    if (method === "initialize") {
      if (requestSeen) rpcError(id, -32600, "duplicate initialize");
      else initialize(id);
    } else if (method === "notifications/initialized") {
      initialized = true;
      if (scenario === "wrong-version")
        process.stderr.write("UNEXPECTED_INITIALIZED\n");
      if (scenario === "server-requests") {
        send({ jsonrpc: "2.0", id: "server-ping", method: "ping" });
        send({
          jsonrpc: "2.0",
          id: "server-unsupported",
          method: "sampling/createMessage",
          params: { messages: [] },
        });
      }
    } else if (method === "notifications/cancelled") {
      cancellations.push((message["params"] as JsonObject | undefined) ?? {});
    } else if (method === "tools/list") {
      listTools(id, message["params"] as JsonObject | undefined);
    } else if (method === "tools/call") {
      callTool(id, message["params"] as JsonObject | undefined);
    }
  } else if (id !== undefined) {
    serverResponses.push(message);
  }
}
