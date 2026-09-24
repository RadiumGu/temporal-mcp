/**
 * stdio.ts — stdio 传输的入口（本地 / npx 用）。
 *
 * 与 `agentcore-http.ts` 并列：两者都只负责「绑定一种传输」，
 * 工具表与分发逻辑都来自 `index.ts` 导出的 `createConfiguredServer()`。
 *
 * 为什么从 `index.ts` 里搬出来：`index.ts` 原本在顶层直接 `main()`，
 * 一被 import 就启动 stdio。而 HTTP 入口必须 import 它拿工具表 ——
 * 于是两个传输会同时启动（实测启动日志里出现过两行）。
 * 库模块不该有顶层副作用，入口才该有。
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConfiguredServer } from './index.js';

async function main(): Promise<void> {
  const { server, tier, toolCount } = createConfiguredServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 日志必须走 stderr —— stdout 在 stdio 模式下是协议通道，
  // 往里写一个字节就会污染 MCP 报文。
  process.stderr.write(`Temporal MCP server started (tools: ${tier}, ${toolCount} loaded)\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
