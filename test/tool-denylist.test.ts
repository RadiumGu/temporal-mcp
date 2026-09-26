/**
 * tool-denylist.test.ts
 *
 * 这个测试的重点是一个**容易写成假闸门**的地方。
 *
 * 把工具从 `tools/list` 里过滤掉，直觉上像是禁用了它 —— 但 MCP 客户端
 * 完全可以直接按名字发 `tools/call`，而分派是 `switch (name)`，
 * 照样会执行。所以"隐藏"和"拦截"必须分别断言，尤其要有
 * **列表里没有、但调用仍然成功** 这个反向控制 —— 那正是回归时会破的形状。
 *
 * 所以这里不 stub 分派逻辑，而是用 InMemoryTransport 接一个真实 MCP
 * 客户端去打真实 server：断言的是协议层可观测的行为，不是内部函数。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const ORIGINAL_ENV = { ...process.env };

/** 起一个带指定环境的 server，并接上一个真实 MCP 客户端。 */
async function connect(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  // server 在 import 时不读环境 —— createConfiguredServer() 才读，
  // 所以必须在设好环境之后动态 import 并调用。
  const { createConfiguredServer } = await import('../src/index.js');
  const { server } = createConfiguredServer();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('TEMPORAL_DENY_TOOLS', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, TEMPORAL_ADDRESS: 'http://127.0.0.1:1' };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('默认不禁任何工具 —— 升级本版本不该静默改变已有部署的行为', async () => {
    const { client } = await connect({ TEMPORAL_TOOLS: 'essential' });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('terminate_workflow');
    expect(names).toContain('signal_workflow');
    // update_workflow 进了 essential：它是受 validator 保护的写通道。
    expect(names).toContain('update_workflow');
  });

  it('被禁的工具不出现在 tools/list 里', async () => {
    const { client } = await connect({
      TEMPORAL_TOOLS: 'essential',
      TEMPORAL_DENY_TOOLS: 'terminate_workflow, cancel_workflow',
    });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('terminate_workflow');
    expect(names).not.toContain('cancel_workflow');
    // 只禁指名的那些，别的不受影响。
    expect(names).toContain('update_workflow');
    expect(names).toContain('start_workflow');
  });

  it('★ 被禁的工具即使被直接按名字调用也必须被拦 —— 不只是从列表里隐藏', async () => {
    const { client } = await connect({
      TEMPORAL_TOOLS: 'essential',
      TEMPORAL_DENY_TOOLS: 'terminate_workflow',
    });

    const res = await client.callTool({
      name: 'terminate_workflow',
      arguments: { workflow_id: 'dr-rebuild-1790322231', reason: 'oops' },
    });

    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('disabled on this server by TEMPORAL_DENY_TOOLS');
    // 拒绝文案要明确说这是配置决定、不要重试、不要找等价工具绕过 ——
    // 否则一个 agent 会把它当瞬时错误反复撞，或换 cancel_workflow 再来一次。
    expect(text).toContain('do not retry');
  });

  it('反向控制：不禁它时同名调用会走进真实分派（因此因连不上服务端而失败，不是被拦）', async () => {
    const { client } = await connect({ TEMPORAL_TOOLS: 'essential' });
    const res = await client.callTool({
      name: 'terminate_workflow',
      arguments: { workflow_id: 'x' },
    });
    // 一样是 isError，但原因必须**不是**门禁 —— 这条断言保证上一个测试
    // 测到的是闸门本身，而不是"反正都会失败"。
    const text = (res.content as { type: string; text: string }[])[0].text;
    expect(text).not.toContain('TEMPORAL_DENY_TOOLS');
  });

  it('空白与空项被忽略，不会意外禁掉一个空名字', async () => {
    const { client } = await connect({
      TEMPORAL_TOOLS: 'essential',
      TEMPORAL_DENY_TOOLS: ' , ,  signal_workflow , ',
    });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('signal_workflow');
    expect(names.length).toBeGreaterThan(5);
  });
});
