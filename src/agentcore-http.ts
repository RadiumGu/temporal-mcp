/**
 * agentcore-http.ts — Amazon Bedrock AgentCore Runtime 的 MCP 传输入口。
 *
 * ## 为什么需要这一层
 *
 * 上游只有 `StdioServerTransport`（给「本地进程 + stdin/stdout」设计的），
 * 而 AgentCore Runtime 要求 **HTTP**：把 MCP RPC POST 到容器的 8000 端口。
 *
 * ## AgentCore Runtime 的协议契约（平台要求，不是我们的选择）
 *
 * | 要求 | 本实现 |
 * |---|---|
 * | 监听 `0.0.0.0` | `BIND_HOST`，默认 `0.0.0.0` |
 * | 端口 `8000` | `PORT`，默认 `8000` |
 * | `POST /mcp` 接收 MCP RPC | 有 |
 * | stateless streamable-HTTP | `sessionIdGenerator: undefined` |
 * | 不得拒绝平台注入的 `Mcp-Session-Id` | stateless 模式下不做会话校验 |
 * | 支持 `tools/list`、`tools/call` | 由 `createConfiguredServer()` 提供 |
 *
 * 契约照抄一个已在 ap-northeast-1 READY 的参照实现，不是推测的形状。
 *
 * ## 本文件刻意很薄
 *
 * 真正的请求处理在 `agentcore-handler.ts` —— 因为本文件顶层就 listen，
 * 测不了，而「多个请求都要成功」这件事必须被测试守住（那个缺陷部署后
 * 表现为 status READY、日志无报错、但每次 invoke 都 500）。
 *
 * ## 关于认证：这里刻意不做认证
 *
 * AgentCore Runtime 在请求到达本进程**之前**就完成了认证。
 *
 * ⚠️ **这个前提只在 AgentCore Runtime 里成立。** 直接跑在 EC2 上，
 * 它就是一个无认证、能启动/终止 Temporal workflow 的端点 ——
 * 而本项目里那些 workflow 是用来切换生产 region 的。
 */

import { createServer } from 'node:http';
import { createConfiguredServer } from './index.js';
import { createMcpRequestListener, MCP_PATH } from './agentcore-handler.js';

const PORT = Number(process.env.PORT ?? '8000');
const BIND_HOST = process.env.BIND_HOST ?? '0.0.0.0';

function main(): void {
  // 先建一次，只为在启动时就暴露配置错误（缺 TEMPORAL_ADDRESS 之类）。
  // 这个实例不被复用 —— 每个请求自己建，原因见 agentcore-handler.ts。
  const { tier, toolCount } = createConfiguredServer();

  createServer(createMcpRequestListener(toolCount)).listen(PORT, BIND_HOST, () => {
    // 日志走 stderr：保持与上游 stdio 模式同一习惯，
    // 免得将来混用时把日志写进协议通道。
    process.stderr.write(
      `temporal-mcp AgentCore transport on ${BIND_HOST}:${PORT}${MCP_PATH} ` +
        `(tools: ${tier}, ${toolCount} loaded)\n`
    );
  });
}

try {
  main();
} catch (err) {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
