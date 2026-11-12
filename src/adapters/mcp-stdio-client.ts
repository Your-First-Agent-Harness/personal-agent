import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const MCP_PROTOCOL_VERSION = "2025-11-25";

export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly serverInfo: McpServerInfo;
  readonly instructions?: string;
}

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpListToolsResult {
  readonly tools: readonly McpTool[];
  readonly nextCursor?: string;
}

export interface McpContentBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface McpCallToolResult {
  readonly content: readonly McpContentBlock[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
}

export interface McpRequestOptions {
  readonly signal?: AbortSignal;
}

export interface McpNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface StdioMcpClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly requestTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly maxToolListPages?: number;
  readonly maxStderrChars?: number;
  readonly onNotification?: (notification: McpNotification) => void;
}

export type McpClientErrorCode =
  | "INVALID_STATE"
  | "VERSION_UNSUPPORTED"
  | "PROTOCOL_ERROR"
  | "TRANSPORT_ERROR"
  | "RPC_ERROR"
  | "CAPABILITY_MISSING"
  | "PAGINATION_LIMIT"
  | "TIMEOUT"
  | "ABORTED";

export class McpClientError extends Error {
  readonly code: McpClientErrorCode;

  constructor(
    code: McpClientErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "McpClientError";
    this.code = code;
  }
}

export class McpRpcError extends McpClientError {
  readonly rpcCode: number;
  readonly data: unknown;

  constructor(rpcCode: number, message: string, data: unknown) {
    super("RPC_ERROR", message);
    this.name = "McpRpcError";
    this.rpcCode = rpcCode;
    this.data = data;
  }
}

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

type ClientState = "idle" | "connecting" | "ready" | "closing" | "closed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInitializeResult(value: unknown): McpInitializeResult {
  if (!isRecord(value)) {
    throw new McpClientError("PROTOCOL_ERROR", "initialize result 必须是对象");
  }
  const serverInfo = value["serverInfo"];
  if (
    value["protocolVersion"] !== MCP_PROTOCOL_VERSION ||
    !isRecord(value["capabilities"]) ||
    !isRecord(serverInfo) ||
    typeof serverInfo["name"] !== "string" ||
    typeof serverInfo["version"] !== "string"
  ) {
    if (value["protocolVersion"] !== MCP_PROTOCOL_VERSION) {
      throw new McpClientError(
        "VERSION_UNSUPPORTED",
        `Server 协议版本不受支持：${String(value["protocolVersion"])}`,
      );
    }
    throw new McpClientError(
      "PROTOCOL_ERROR",
      "initialize result 缺少必要字段",
    );
  }
  return value as unknown as McpInitializeResult;
}

export class StdioMcpClient {
  private readonly options: StdioMcpClientOptions;
  private child?: ChildProcessWithoutNullStreams;
  private state: ClientState = "idle";
  private nextRequestId = 1;
  private stdoutBuffer = "";
  private closePromise?: Promise<void>;
  private capabilities: Readonly<Record<string, unknown>> = {};
  private stderr = "";
  private readonly pending = new Map<number, PendingRequest>();

  constructor(options: StdioMcpClientOptions) {
    this.options = options;
  }

  async connect(): Promise<McpInitializeResult> {
    if (this.state !== "idle") {
      throw new McpClientError(
        "INVALID_STATE",
        `当前状态 ${this.state} 不能再次 connect`,
      );
    }
    this.state = "connecting";
    this.child = spawn(this.options.command, [...(this.options.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env ?? {},
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", this.onStdout);
    this.child.stderr.on("data", this.onStderr);
    this.child.on("error", this.onProcessError);
    this.child.on("exit", this.onProcessExit);

    try {
      const response = await this.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "personal-agent", version: "0.1.0" },
      });
      const initialized = readInitializeResult(response);
      this.capabilities = initialized.capabilities;
      this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      this.state = "ready";
      return initialized;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async listTools(
    cursor?: string,
    options: McpRequestOptions = {},
  ): Promise<McpListToolsResult> {
    this.assertToolsReady();
    const response = await this.request(
      "tools/list",
      cursor === undefined ? {} : { cursor },
      options,
    );
    if (!isRecord(response) || !Array.isArray(response["tools"])) {
      throw new McpClientError(
        "PROTOCOL_ERROR",
        "tools/list result 缺少 tools 数组",
      );
    }
    const nextCursor = response["nextCursor"];
    if (nextCursor !== undefined && typeof nextCursor !== "string") {
      throw new McpClientError(
        "PROTOCOL_ERROR",
        "tools/list nextCursor 必须是字符串",
      );
    }
    return response as unknown as McpListToolsResult;
  }

  async listAllTools(
    options: McpRequestOptions = {},
  ): Promise<readonly McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    const maxPages = this.options.maxToolListPages ?? 100;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.listTools(cursor, options);
      tools.push(...result.tools);
      if (result.nextCursor === undefined) return tools;
      cursor = result.nextCursor;
    }
    throw new McpClientError(
      "PAGINATION_LIMIT",
      `tools/list 分页超过上限 ${maxPages}，可能存在循环游标`,
    );
  }

  async callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>> = {},
    options: McpRequestOptions = {},
  ): Promise<McpCallToolResult> {
    this.assertToolsReady();
    const response = await this.request(
      "tools/call",
      { name, arguments: arguments_ },
      options,
    );
    if (!isRecord(response) || !Array.isArray(response["content"])) {
      throw new McpClientError(
        "PROTOCOL_ERROR",
        "tools/call result 缺少 content 数组",
      );
    }
    if (
      response["structuredContent"] !== undefined &&
      !isRecord(response["structuredContent"])
    ) {
      throw new McpClientError(
        "PROTOCOL_ERROR",
        "tools/call structuredContent 必须是对象",
      );
    }
    if (
      response["isError"] !== undefined &&
      typeof response["isError"] !== "boolean"
    ) {
      throw new McpClientError(
        "PROTOCOL_ERROR",
        "tools/call isError 必须是布尔值",
      );
    }
    return response as unknown as McpCallToolResult;
  }

  getStderr(): string {
    return this.stderr;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closePromise = this.closeChild();
    return this.closePromise;
  }

  private assertToolsReady(): void {
    if (this.state !== "ready") {
      throw new McpClientError("INVALID_STATE", "connect 成功后才能调用工具");
    }
    if (!isRecord(this.capabilities["tools"])) {
      throw new McpClientError(
        "CAPABILITY_MISSING",
        "Server 未声明 tools capability",
      );
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    const signal = options.signal;
    if (signal?.aborted === true) {
      return Promise.reject(
        new McpClientError("ABORTED", "操作在发送前已取消"),
      );
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const settleResolve = (result: unknown): void => {
        if (!this.pending.delete(id)) return;
        cleanup();
        resolve(result);
      };
      const settleReject = (error: Error): void => {
        if (!this.pending.delete(id)) return;
        cleanup();
        if (error instanceof McpClientError && error.code === "TIMEOUT") {
          this.sendCancellation(id, "timeout");
        } else if (
          error instanceof McpClientError &&
          error.code === "ABORTED"
        ) {
          this.sendCancellation(id, "aborted");
        }
        reject(error);
      };
      const onAbort = (): void => {
        settleReject(new McpClientError("ABORTED", "MCP 请求已取消"));
      };
      const timer = setTimeout(() => {
        settleReject(
          new McpClientError(
            "TIMEOUT",
            `MCP 请求 ${method} 超过 ${this.options.requestTimeoutMs ?? 10_000}ms`,
          ),
        );
      }, this.options.requestTimeoutMs ?? 10_000);
      this.pending.set(id, { resolve: settleResolve, reject: settleReject });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        settleReject(error as Error);
      }
    });
  }

  private sendCancellation(requestId: number, reason: string): void {
    if (this.state === "closing" || this.state === "closed") return;
    try {
      this.send({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId, reason },
      });
    } catch {
      // 保留原始超时/取消错误；传输已关闭时无需再发送取消通知。
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.child === undefined || this.child.stdin.destroyed) {
      throw new McpClientError("TRANSPORT_ERROR", "MCP Server stdin 不可写");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private readonly onStdout = (chunk: string): void => {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.fail(
          new McpClientError("PROTOCOL_ERROR", "stdout 含非 JSON 帧", {
            cause: error,
          }),
        );
        return;
      }
      if (!this.handleMessage(message)) return;
    }
  };

  private handleMessage(message: unknown): boolean {
    if (!isRecord(message) || message["jsonrpc"] !== "2.0") {
      this.fail(
        new McpClientError(
          "PROTOCOL_ERROR",
          "stdout 帧不是合法 JSON-RPC 2.0 消息",
        ),
      );
      return false;
    }
    const method = message["method"];
    const id = message["id"];
    if (typeof method === "string") {
      if (id === undefined) {
        try {
          this.options.onNotification?.({
            method,
            ...("params" in message ? { params: message["params"] } : {}),
          });
        } catch (error) {
          this.fail(
            new McpClientError("PROTOCOL_ERROR", "通知观察器抛出错误", {
              cause: error,
            }),
          );
          return false;
        }
        return true;
      }
      if (typeof id !== "string" && typeof id !== "number") {
        this.fail(
          new McpClientError("PROTOCOL_ERROR", "Server 请求包含非法 id"),
        );
        return false;
      }
      if (method === "ping") {
        this.send({ jsonrpc: "2.0", id, result: {} });
      } else {
        this.send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
      }
      return true;
    }

    if (typeof id !== "number") {
      this.fail(
        new McpClientError("PROTOCOL_ERROR", "响应缺少有效 request id"),
      );
      return false;
    }
    const hasResult = "result" in message;
    const hasError = "error" in message;
    if (hasResult === hasError) {
      this.fail(
        new McpClientError(
          "PROTOCOL_ERROR",
          "响应必须且只能包含 result 或 error",
        ),
      );
      return false;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      this.fail(
        new McpClientError("PROTOCOL_ERROR", "响应包含未知 request id"),
      );
      return false;
    }
    if (hasError) {
      const rpcError = message["error"];
      if (
        !isRecord(rpcError) ||
        typeof rpcError["code"] !== "number" ||
        typeof rpcError["message"] !== "string"
      ) {
        this.fail(
          new McpClientError("PROTOCOL_ERROR", "响应 error 缺少 code/message"),
        );
        return false;
      }
      pending.reject(
        new McpRpcError(
          rpcError["code"],
          rpcError["message"],
          rpcError["data"],
        ),
      );
    } else {
      pending.resolve(message["result"]);
    }
    return true;
  }

  private readonly onStderr = (chunk: string): void => {
    this.stderr = (this.stderr + chunk).slice(
      -(this.options.maxStderrChars ?? 65_536),
    );
  };

  private readonly onProcessError = (error: Error): void => {
    this.fail(
      new McpClientError("TRANSPORT_ERROR", "MCP Server 进程错误", {
        cause: error,
      }),
    );
  };

  private readonly onProcessExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    this.state = "closed";
    this.rejectAll(
      new McpClientError(
        "TRANSPORT_ERROR",
        `MCP Server 提前退出（code=${String(code)}, signal=${String(signal)}）`,
      ),
    );
  };

  private fail(error: McpClientError): void {
    this.rejectAll(error);
    void this.close();
  }

  private rejectAll(error: McpClientError): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private async closeChild(): Promise<void> {
    const child = this.child;
    if (
      child === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      this.rejectAll(
        new McpClientError("TRANSPORT_ERROR", "MCP Client 已关闭"),
      );
      this.state = "closed";
      this.cleanupChildListeners();
      return;
    }
    this.state = "closing";
    this.rejectAll(
      new McpClientError("TRANSPORT_ERROR", "MCP Client 正在关闭"),
    );
    child.stdin.end();
    await new Promise<void>((resolve) => {
      let killTimer: NodeJS.Timeout | undefined;
      const terminateTimer = setTimeout(() => {
        child.kill("SIGTERM");
        killTimer = setTimeout(
          () => child.kill("SIGKILL"),
          this.options.closeTimeoutMs ?? 2_000,
        );
      }, this.options.closeTimeoutMs ?? 2_000);
      child.once("exit", () => {
        clearTimeout(terminateTimer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolve();
      });
    });
    this.state = "closed";
    this.cleanupChildListeners();
  }

  private cleanupChildListeners(): void {
    if (this.child === undefined) return;
    this.child.stdout.off("data", this.onStdout);
    this.child.stderr.off("data", this.onStderr);
    this.child.off("error", this.onProcessError);
    this.child.off("exit", this.onProcessExit);
  }
}
