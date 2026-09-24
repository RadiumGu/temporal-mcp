/**
 * workflows.start-fields.test.ts
 *
 * 断言 start_workflow 真的把 DR 必需的字段发上线，且用的是**实测确认**
 * 的线上名字。
 *
 * 为什么这些断言值得存在：服务端对未知字段是硬拒绝而非静默丢弃
 * （实测 {"code":3,"message":"temporalproto: ... unknown field
 * \"totallyBogusField\""}），所以名字写错 = 工具在真实环境里直接不可用。
 * 而离线测试唯一能守住的就是「名字有没有写对」。
 */

import { describe, it, expect, vi } from 'vitest';
import { handleStartWorkflow } from '../src/tools/workflows.js';
import type { TemporalClient } from '../src/client.js';

function stubClient() {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const client = {
    ns: (n?: string) => n ?? 'default',
    post: vi.fn(async (path: string, body?: Record<string, unknown>) => {
      calls.push({ path, body });
      return { runId: 'r-1', started: true };
    }),
  } as unknown as TemporalClient;
  return { client, calls };
}

const base = {
  workflow_id: 'dr-failover-1',
  workflow_type: 'DrFailover',
  task_queue: 'dr-plan-queue',
};

describe('start_workflow 发给服务端的字段名（实测确认）', () => {
  it('三个超时用的是 workflowExecutionTimeout / workflowRunTimeout / workflowTaskTimeout', async () => {
    const { client, calls } = stubClient();
    await handleStartWorkflow(
      { ...base, execution_timeout: '3600s', run_timeout: '1800s', task_timeout: '30s' } as never,
      client
    );
    const b = calls[0].body!;
    expect(b.workflowExecutionTimeout).toBe('3600s');
    expect(b.workflowRunTimeout).toBe('1800s');
    expect(b.workflowTaskTimeout).toBe('30s');
  });

  it('identity / requestId / workflowIdReusePolicy / retryPolicy 都按线上名发出', async () => {
    const { client, calls } = stubClient();
    await handleStartWorkflow(
      {
        ...base,
        identity: 'dr-plan-generator@probe',
        request_id: '11111111-2222-3333-4444-555555555555',
        id_reuse_policy: 'WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE',
        retry_policy: { initialInterval: '5s', maximumAttempts: 3 },
      } as never,
      client
    );
    const b = calls[0].body!;
    expect(b.identity).toBe('dr-plan-generator@probe');
    // 注意是 requestId 而不是 request_id —— 线上是驼峰。
    expect(b.requestId).toBe('11111111-2222-3333-4444-555555555555');
    expect(b.workflowIdReusePolicy).toBe('WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE');
    expect(b.retryPolicy).toEqual({ initialInterval: '5s', maximumAttempts: 3 });
  });

  it('memo 包成 {fields:{k:{metadata,data}}}，值是 base64 的 JSON', async () => {
    const { client, calls } = stubClient();
    await handleStartWorkflow(
      { ...base, memo: { plan: 'region-failover' } } as never,
      client
    );
    const memo = calls[0].body!.memo as {
      fields: Record<string, { metadata: { encoding: string }; data: string }>;
    };
    expect(Object.keys(memo.fields)).toEqual(['plan']);
    // 实测服务端接受的编码就是 base64 的 'json/plain'。
    expect(Buffer.from(memo.fields.plan.metadata.encoding, 'base64').toString()).toBe('json/plain');
    expect(Buffer.from(memo.fields.plan.data, 'base64').toString()).toBe('"region-failover"');
  });

  it('searchAttributes 包成 {indexedFields:{...}}，不是 {fields:{...}}', async () => {
    const { client, calls } = stubClient();
    await handleStartWorkflow(
      { ...base, search_attributes: { CustomKeywordField: 'dr-drill' } } as never,
      client
    );
    const sa = calls[0].body!.searchAttributes as Record<string, unknown>;
    // memo 用 fields，searchAttributes 用 indexedFields —— 两个不一样，
    // 混用会被服务端拒（未知字段硬失败）。
    expect(sa).toHaveProperty('indexedFields');
    expect(sa).not.toHaveProperty('fields');
  });

  it('不传的字段一个都不出现在请求体里（服务端拒绝未知/空字段）', async () => {
    const { client, calls } = stubClient();
    await handleStartWorkflow({ ...base } as never, client);
    const b = calls[0].body!;
    expect(Object.keys(b).sort()).toEqual(['taskQueue', 'workflowType']);
  });

  it('输出必须提醒「启动成功不等于有 worker 在执行」', async () => {
    // 实测：无 worker 的队列同样返回 started:true / RUNNING。
    // 把它读成「切换已启动」对灾备是危险误读，所以输出里必须有这句提醒。
    const { client } = stubClient();
    const out = await handleStartWorkflow({ ...base } as never, client);
    const text = (out.content[0] as { text: string }).text;
    expect(text).toContain('started: true');
    expect(text).toMatch(/不表示有 worker|describe_task_queue/);
    expect(text).toContain('dr-plan-queue');
  });
});
