/**
 * agentcore-handler.ts —— AgentCore MCP 契约的请求处理器（可测部分）。
 *
 * 从 `agentcore-http.ts` 里抽出来，好让「多个请求都要成功」这件事
 * 能被测试守住 —— 那个入口模块顶层就 listen，测不了。
 *
 * 契约（平台要求）：`POST /mcp`、stateless streamable-HTTP、
 * 监听 0.0.0.0:8000、不得拒绝平台注入的 `Mcp-Session-Id`。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createConfiguredServer } from './index.js';

export const MCP_PATH = '/mcp';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 每个 POST /mcp 都新建一对 Server + Transport，用完就关。
 *
 * ## 为什么不能共用一个实例
 *
 * 第一版在启动时建了**一个** StreamableHTTPServerTransport 并 connect
 * 到一个 Server，然后把每个 HTTP 请求都塞进去。实测结果是它
 * **只能服务一次请求**，而且请求内容完全相同：
 *
 *     好请求 #1 → HTTP 200
 *     好请求 #2 → HTTP 500
 *     好请求 #3 → HTTP 500
 *
 * 部署到 AgentCore 后的表现极具误导性：
 *   - 控制面 status: READY
 *   - 容器日志只有正常的启动行，**没有任何报错**
 *   - 但每次 invoke 都回 -32010 / "Received error (500) from runtime"
 *
 * 因为平台先前的某次探测已经把那唯一一次用掉了。只看日志查不出来。
 *
 * stateless 模式的正确用法就是每请求一对实例：SDK 的 stateless 传输
 * 不为多请求复用设计，共用还会让并发请求在 JSON-RPC id 上撞车。
 *
 * ## 开销
 *
 * createConfiguredServer() 只是组装工具表并注册两个 handler，
 * client 是薄 fetch 封装、没有连接池。真正的耗时在对 Temporal 的
 * HTTP 调用上，这点组装开销可以忽略。
 */
export async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let transport: StreamableHTTPServerTransport | undefined;
  try {
    const { server } = createConfiguredServer();
    transport = new StreamableHTTPServerTransport({
      // stateless：传 undefined 是 SDK 文档里 stateless 模式的显式写法。
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    // 不预读 body：SDK 的 handleRequest 在第三参缺省时自己读流。
    await transport.handleRequest(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`handleRequest failed: ${msg}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: msg });
  } finally {
    try {
      await transport?.close();
    } catch {
      // 关闭失败不该影响已经发出的响应。
    }
  }
}

/** 建一个符合 AgentCore 契约的 requestListener。 */
export function createMcpRequestListener(toolCount: number) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';

    // 平台的健康检查。MCP_PATH 也接受 GET —— 参照实现就是这么做的。
    if (req.method === 'GET' && ['/', '/ping', '/health', MCP_PATH].includes(path)) {
      sendJson(res, 200, { status: 'ok', server: 'temporal-mcp', tools: toolCount });
      return;
    }

    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: `未知路径 ${req.url}，MCP 端点是 ${MCP_PATH}` });
      return;
    }

    void handleMcpPost(req, res);
  };
}
