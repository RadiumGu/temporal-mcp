/**
 * agentcore-handler.test.ts
 *
 * 守住一个部署后极难查的缺陷：**传输实例被复用时只能服务一次请求**。
 *
 * 它的表现是：
 *   - AgentCore 控制面 status: READY
 *   - 容器日志只有正常启动行，没有任何报错
 *   - 但每次 invoke 都回 -32010 / "Received error (500) from runtime"
 *
 * 所以这个测试是唯一能在部署前发现它的手段。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpRequestListener } from '../src/agentcore-handler.js';

let server: Server;
let base: string;

beforeAll(async () => {
  // 指向一个不可达的 Temporal：本测试只验协议层与实例生命周期，
  // 不验对 Temporal 的调用（那要活集群，已另外实测过）。
  process.env.TEMPORAL_ADDRESS = 'http://127.0.0.1:19999';
  process.env.TEMPORAL_TOOLS = 'all';

  server = createServer(createMcpRequestListener(36));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 按 AgentCore 契约发一个 MCP RPC。 */
async function rpc(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // SDK 的 streamable-HTTP 要求 Accept 同时含这两种。
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

describe('AgentCore MCP 请求处理器', () => {
  it('连续多个相同请求必须都成功（复用单个 transport 时第二个就 500）', async () => {
    // 这是核心断言。实测过的失败形态：
    //   #1 → 200, #2 → 500, #3 → 500
    for (let i = 1; i <= 4; i++) {
      const res = await rpc(LIST);
      expect(res.status, `第 ${i} 个请求`).toBe(200);
    }
  });

  it('平台注入的 Mcp-Session-Id 不得导致请求被拒', async () => {
    // 契约原文：平台会为任何不带该头的请求自动加上它，
    // stateless 服务器不得拒绝。
    const res = await rpc(LIST, { 'Mcp-Session-Id': '2e8d128a-2fc5-45d2-bb46-9b192d2a3bbe' });
    expect(res.status).toBe(200);
  });

  it('一个坏请求不得污染后续请求', async () => {
    // 缺 Accept 的请求自己失败（406），但不能把后面的带下去。
    const bad = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(LIST),
    });
    expect(bad.status).not.toBe(200);
    // 关键：坏请求之后的好请求仍须 200。
    const good = await rpc(LIST);
    expect(good.status).toBe(200);
  });

  it('tools/list 返回的工具表非空', async () => {
    const res = await rpc(LIST);
    const text = await res.text();
    // stateless streamable-HTTP 用 SSE 帧回，正文在 data: 行里。
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    expect(line, 'SSE data 行').toBeDefined();
    const payload = JSON.parse(line!.slice(6)) as { result?: { tools?: unknown[] } };
    expect(payload.result?.tools?.length).toBeGreaterThan(0);
  });

  it('健康检查路径按契约应答', async () => {
    for (const p of ['/ping', '/health', '/mcp', '/']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, `GET ${p}`).toBe(200);
      const body = (await res.json()) as { status?: string };
      expect(body.status).toBe('ok');
    }
  });

  it('未知路径回 404 而不是静默接受', async () => {
    const res = await fetch(`${base}/not-a-real-path`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
