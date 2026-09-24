/**
 * agentcore-http.ts — Amazon Bedrock AgentCore Runtime 的 MCP 传输层。
 *
 * ## 为什么需要这一层
 *
 * 上游只有 `StdioServerTransport`（给「本地进程 + stdin/stdout」设计的），
 * 而 AgentCore Runtime 要求 **HTTP**：把 MCP RPC POST 到容器的 8000 端口。
 * 两者不是一回事，所以必须有这一层。
 *
 * ## AgentCore Runtime 的协议契约（平台要求，不是我们的选择）
 *
 * | 要求 | 本实现 |
 * |---|---|
 * | 监听 `0.0.0.0` | `BIND_HOST`，默认 `0.0.0.0` |
 * | 端口 `8000` | `PORT`，默认 `8000` |
 * | `POST /mcp` 接收 MCP RPC | 有 |
 * | stateless streamable-HTTP | `sessionIdGenerator: undefined` |
 * | 不得拒绝平台注入的 `Mcp-Session-Id` | stateless 模式下 SDK 不做会话校验 |
 * | 支持 `tools/list`、`tools/call` | 由 `createConfiguredServer()` 提供 |
 *
 * 这份契约照抄本仓库外的参照实现 `graph_mcp/agentcore_app.py` ——
 * 那个 runtime 在 ap-northeast-1 已经 READY，是已验证过的形状，不是推测。
 *
 * ## 两个刻意的选择
 *
 * **① 用 SDK 的 `StreamableHTTPServerTransport`，不手写 JSON-RPC。**
 * 我第一版真的手写了一遍（initialize / tools/list / tools/call 三个分支 +
 * 自己的错误码），写完才发现 SDK 1.27.1 自带 `server/streamableHttp.js`。
 * 手写的那版还顺带复制了一份工具表 —— 而工具表在 index.ts 里有 36 个分支，
 * 复制一份就等于埋下「某个工具在一个传输上能用、在另一个上报 Unknown tool」
 * 这类漂移。已废弃那版。
 *
 * **② 工具表与分发从 `index.ts` 的 `createConfiguredServer()` 拿，
 * 不在这里重建。** 单一来源，两个传输共用。
 *
 * ## 关于认证：这里刻意不做认证
 *
 * AgentCore Runtime 在请求到达本进程**之前**就完成了 JWT 校验。
 * 本服务信任「调用方已被 AgentCore 认证过」。
 *
 * ⚠️ **这个前提只在 AgentCore Runtime 里成立。** 直接把它跑在 EC2 上，
 * 它就是一个无认证、能启动/终止 Temporal workflow 的端点 ——
 * 而本项目里那些 workflow 是用来切换生产 region 的。
 */

import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createConfiguredServer } from './index.js';

const PORT = Number(process.env.PORT ?? '8000');
const BIND_HOST = process.env.BIND_HOST ?? '0.0.0.0';
const MCP_PATH = '/mcp';

async function main(): Promise<void> {
  // createConfiguredServer 内部会 createClientFromEnv()，缺 TEMPORAL_ADDRESS
  // 时在这里就抛 —— 快速失败，而不是等第一次 tools/call 才发现配置错。
  const { server, tier, toolCount } = createConfiguredServer();

  const transport = new StreamableHTTPServerTransport({
    // stateless：AgentCore 每个请求自包含，平台自己管会话。
    // 传 undefined 是 SDK 文档里 stateless 模式的显式写法。
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const http = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';

    // 平台的健康检查。MCP_PATH 也接受 GET —— 参照实现就是这么做的。
    if (req.method === 'GET' && ['/', '/ping', '/health', MCP_PATH].includes(path)) {
      const body = JSON.stringify({ status: 'ok', server: 'temporal-mcp', tools: toolCount });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (path !== MCP_PATH) {
      const body = JSON.stringify({ error: `未知路径 ${req.url}，MCP 端点是 ${MCP_PATH}` });
      res.writeHead(404, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    // 不预读 body：SDK 的 handleRequest 在第三参缺省时自己读流。
    // 预读再传进去也行，但那就要自己管大小上限与编码，多一处会出错的地方。
    void transport.handleRequest(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`handleRequest failed: ${msg}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  });

  http.listen(PORT, BIND_HOST, () => {
    // 日志走 stderr：保持与上游 stdio 模式同一习惯，
    // 免得将来混用时把日志写进协议通道。
    process.stderr.write(
      `temporal-mcp AgentCore transport on ${BIND_HOST}:${PORT}${MCP_PATH} ` +
        `(tools: ${tier}, ${toolCount} loaded)\n`
    );
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
