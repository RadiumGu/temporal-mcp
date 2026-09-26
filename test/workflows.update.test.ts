/**
 * workflows.update.test.ts
 *
 * `update_workflow` 存在的理由只有一条：**它能拒绝**。
 * 所以这里最要紧的断言不是"请求发对了"，而是**validator 拒绝时不许报成功**。
 *
 * ⚠️ 被拒的 update 同样是 HTTP 200。这不是边缘情况，而是这个 API 的常态
 * 形状：`outcome.failure` 与 `outcome.success` 是同一个 200 响应里的两个
 * 分支。把前者读成"已发送"，调用方会以为计划已被修订 / 审批已生效，
 * 而 history 里一条都没有 —— 这是本项目反复踩过的那类误报
 * （"命令成功 ≠ 生效"）在 MCP 层的翻版。
 *
 * 请求体形状取自对活服务端（1.29.7，ap-northeast-2）的实测：
 * 只发 `{}` 时服务端回
 *   400 {"code":3,"message":"Update meta is not set on request."}
 * —— 同时证明了路由存在、且 `request.meta` 必填。
 */

import { describe, it, expect, vi } from 'vitest';
import { handleUpdateWorkflow, handleSignalWorkflow } from '../src/tools/workflows.js';
import type { TemporalClient } from '../src/client.js';

function stubClient(response: Record<string, unknown>) {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const client = {
    ns: (n?: string) => n ?? 'default',
    post: vi.fn(async (path: string, body?: Record<string, unknown>) => {
      calls.push({ path, body });
      return response;
    }),
  } as unknown as TemporalClient;
  return { client, calls };
}

/** 把一个 JS 值编成 Temporal payload，用于造成功响应。 */
function payload(value: unknown) {
  return {
    metadata: { encoding: Buffer.from('json/plain').toString('base64') },
    data: Buffer.from(JSON.stringify(value)).toString('base64'),
  };
}

describe('update_workflow：拒绝与成功必须分开', () => {
  it('validator 拒绝时 rejected=true、result=null，并带出拒绝原因', async () => {
    const { client } = stubClient({
      stage: 'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_COMPLETED',
      updateRef: { updateId: 'u-1' },
      outcome: {
        failure: { message: 'invalid decision "maybe"; allowed: ["approve","reject"]' },
      },
    });

    const res = await handleUpdateWorkflow(
      { workflow_id: 'order-42', update_name: 'approve_shipment', input: 'maybe' } as never,
      client
    );

    expect(res.structuredContent?.rejected).toBe(true);
    expect(res.structuredContent?.result).toBeNull();
    expect(String(res.structuredContent?.rejectionReason)).toContain('invalid decision');
    // 文本里必须能一眼看出什么都没改 —— 不能读成"已发送"。
    expect(res.content[0].text).toContain('REJECTED');
    expect(res.content[0].text).not.toContain('accepted and applied');
  });

  it('接受时 rejected=false，并把 handler 的返回值解码出来', async () => {
    const { client } = stubClient({
      stage: 'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_COMPLETED',
      updateRef: { updateId: 'u-2' },
      outcome: { success: { payloads: [payload({ accepted: true, version: 2 })] } },
    });

    const res = await handleUpdateWorkflow(
      { workflow_id: 'order-42', update_name: 'revise_plan', input: { body: 'x' } } as never,
      client
    );

    expect(res.structuredContent?.rejected).toBe(false);
    expect(res.structuredContent?.result).toEqual({ accepted: true, version: 2 });
  });

  it('★ 网关返回的 success 是已解码数组时也要解得出来（实测形状）', async () => {
    // 实测（Server 1.32.0 HTTP 网关）：请求侧要自己 base64，响应侧**已经解码**。
    //   {"outcome":{"success":[{"accepted":true,"version":2}]}}
    // 第一版按"请求/响应对称"写，结果是 rejected=false 而 result=null ——
    // 报告成功却丢掉了 handler 的返回值，是最坏的一类错报。
    const { client } = stubClient({
      stage: 'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_COMPLETED',
      outcome: { success: [{ accepted: true, version: 2, sha256: 'abc' }] },
    });
    const res = await handleUpdateWorkflow(
      { workflow_id: 'order-42', update_name: 'revise_plan' } as never,
      client
    );
    expect(res.structuredContent?.rejected).toBe(false);
    expect(res.structuredContent?.result).toEqual({
      accepted: true, version: 2, sha256: 'abc',
    });
    // 反向：修复前这里是 null。
    expect(res.structuredContent?.result).not.toBeNull();
  });

  it('handler 返回 None（无 payload）也算接受，不能因此判成拒绝', async () => {
    // 反向控制：空 success 与 failure 都是"没有 payload"，靠的是哪个键存在。
    const { client } = stubClient({ outcome: { success: {} } });
    const res = await handleUpdateWorkflow(
      { workflow_id: 'w', update_name: 'u' } as never,
      client
    );
    expect(res.structuredContent?.rejected).toBe(false);
    expect(res.structuredContent?.result).toBeNull();
  });

  it('请求体带 request.meta —— 缺它服务端实测回 400', async () => {
    const { client, calls } = stubClient({ outcome: { success: {} } });
    await handleUpdateWorkflow(
      {
        workflow_id: 'order-42',
        update_name: 'approve_plan',
        input: { version: 2 },
        identity: 'alice',
        update_id: 'idem-1',
        wait_stage: 'ACCEPTED',
      } as never,
      client
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(
      '/api/v1/namespaces/default/workflows/order-42/update/approve_plan'
    );
    const req = calls[0].body?.request as Record<string, Record<string, unknown>>;
    expect(req.meta).toEqual({ updateId: 'idem-1', identity: 'alice' });
    expect(req.input.name).toBe('approve_plan');
    // 等待阶段要发带前缀的枚举名 —— 与 taskQueueType 同一个坑。
    expect((calls[0].body?.waitPolicy as Record<string, unknown>).lifecycleStage).toBe(
      'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_ACCEPTED'
    );
  });

  it('默认等到 COMPLETED —— 否则拿不到 handler 的返回值', async () => {
    const { client, calls } = stubClient({ outcome: { success: {} } });
    await handleUpdateWorkflow({ workflow_id: 'w', update_name: 'u' } as never, client);
    expect((calls[0].body?.waitPolicy as Record<string, unknown>).lifecycleStage).toBe(
      'UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_COMPLETED'
    );
  });

  it('未声明 identity 时结构化结果显式标注它未经认证', async () => {
    const { client } = stubClient({ outcome: { success: {} } });
    const res = await handleUpdateWorkflow(
      { workflow_id: 'w', update_name: 'u', identity: 'bob' } as never,
      client
    );
    // 这个字段是刻意恒为 false 的：AgentCore 不透传调用方身份（实测
    // agentcore-handler 里零 header 处理），所以 identity 只能是自报。
    expect(res.structuredContent?.identityIsAuthenticated).toBe(false);
    expect(res.structuredContent?.claimedIdentity).toBe('bob');
  });
});

describe('signal_workflow：补上 identity，并明说它没有 validator', () => {
  it('identity / requestId 会进请求体', async () => {
    const { client, calls } = stubClient({});
    await handleSignalWorkflow(
      {
        workflow_id: 'order-42',
        signal_name: 'approve_shipment',
        input: 'ordered',
        identity: 'alice',
        request_id: 'r-1',
      } as never,
      client
    );
    expect(calls[0].body?.identity).toBe('alice');
    expect(calls[0].body?.requestId).toBe('r-1');
  });

  it('回复里必须写明 signal 无 validator —— 否则调用方会误以为它被校验过', async () => {
    const { client } = stubClient({});
    const res = await handleSignalWorkflow(
      { workflow_id: 'w', signal_name: 's' } as never,
      client
    );
    expect(res.content[0].text).toContain('no validator');
    expect(res.content[0].text).toContain('update_workflow');
  });
});

describe('query_workflow：同一个解码缺陷（修复前一直走兜底分支）', () => {
  it('queryResult 是已解码数组时，返回查询结果本身而不是整包协议报文', async () => {
    const { client } = stubClient({
      queryResult: [{ state: 'draft', current_version: 1 }],
    });
    const { handleQueryWorkflow } = await import('../src/tools/workflows.js');
    const res = await handleQueryWorkflow(
      { workflow_id: 'plan-1', query_type: 'plan_state' } as never,
      client
    );
    expect(res.structuredContent?.result).toEqual({ state: 'draft', current_version: 1 });
    // 修复前文本里会出现协议字段名 queryResult —— 那是兜底分支的特征。
    expect(res.content[0].text).not.toContain('queryResult');
    expect(res.content[0].text).toContain('current_version');
  });
});
