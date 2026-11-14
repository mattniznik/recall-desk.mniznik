// How to start the MCP server: the node binary running this process, the flags that let
// it run TypeScript directly, the server file and its session file. Shared by the eval
// runner (which writes it into Claude Code's --mcp-config) and the server's test.

import { join } from "node:path";

export const SERVER_PATH = join(import.meta.dirname, "server.ts");

export function serverCommand(sessionFile: string): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SERVER_PATH, "--session", sessionFile],
  };
}
