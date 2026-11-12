import { StdioMcpClient } from "../src/adapters/mcp-stdio-client.ts";

const serverPackage = "@modelcontextprotocol/server-everything@2025.11.25";

function print(message: string): void {
  process.stdout.write(`${message}\n`);
}

function minimalEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "NPM_CONFIG_CACHE"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

const client = new StdioMcpClient({
  command: process.platform === "win32" ? "npx.cmd" : "npx",
  args: ["--yes", serverPackage, "stdio"],
  env: minimalEnvironment(),
  requestTimeoutMs: 30_000,
  closeTimeoutMs: 2_000,
});

print(`external server: ${serverPackage} (stdio)`);
print("reproduce: npm run demo:d035");
try {
  const initialized = await client.connect();
  print(`initialize result: ${JSON.stringify(initialized)}`);
  if (initialized.protocolVersion !== "2025-11-25") {
    throw new Error("外部 Server 未协商到 2025-11-25");
  }

  const listed = await client.listTools();
  print(
    `tools/list result: ${listed.tools.length} tools; names=${listed.tools
      .map((tool) => tool.name)
      .join(",")}`,
  );
  if (!listed.tools.some((tool) => tool.name === "echo")) {
    throw new Error("外部 Server 未提供预期 echo 工具");
  }

  const message = "D035 real external MCP stdio call";
  const called = await client.callTool("echo", { message });
  print(`tools/call echo arguments: ${JSON.stringify({ message })}`);
  print(`tools/call echo result: ${JSON.stringify(called)}`);
  if (called.isError === true || called.content.length === 0) {
    throw new Error("外部 echo 调用未返回有效内容");
  }
  print("EXTERNAL MCP RESULT: PASS");
} finally {
  await client.close();
  print("close: stdio ended and child exited");
  const stderr = client.getStderr().trim();
  if (stderr.length > 0) {
    const home = process.env["HOME"];
    print(
      `server stderr (diagnostic only): ${
        home === undefined ? stderr : stderr.replaceAll(home, "<HOME>")
      }`,
    );
  }
}
