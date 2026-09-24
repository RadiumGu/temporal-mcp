/**
 * task-queues.live-contract.test.ts
 *
 * 这两个缺陷都是**对活服务端实测**才发现的（Temporal 1.29.7，
 * ap-northeast-2 的灾备站点）。离线比对全部放过了它们 ——
 * 路径对、方法对、字段名对，错在别处。所以这里的断言一律照抄
 * 实测到的真实报文，不照抄规范文档。
 */

import { describe, it, expect, vi } from 'vitest';
import { handleDescribeTaskQueue } from '../src/tools/task-queues.js';
import type { TemporalClient } from '../src/client.js';

/** 造一个只记录请求、按脚本回话的假 client。 */
function stubClient(response: Record<string, unknown>) {
  const calls: { path: string; params?: Record<string, unknown> }[] = [];
  const client = {
    ns: (n?: string) => n ?? 'default',
    get: vi.fn(async (path: string, params?: Record<string, unknown>) => {
      calls.push({ path, params });
      return response;
    }),
  } as unknown as TemporalClient;
  return { client, calls };
}

describe('describe_task_queue 的线上契约（实测得来）', () => {
  it('taskQueueType 必须发带前缀的枚举名，裸 WORKFLOW 会被服务端拒绝', async () => {
    // 实测：taskQueueType=WORKFLOW →
    //   {"code":3,"message":"parsing field \"task_queue_type\":
    //    \"WORKFLOW\" is not a valid value"}
    const { client, calls } = stubClient({ pollers: [] });
    await handleDescribeTaskQueue({ task_queue: 'q' } as never, client);

    expect(calls).toHaveLength(1);
    expect(calls[0].params?.taskQueueType).toBe('TASK_QUEUE_TYPE_WORKFLOW');
    // 反向：这个断言在修复前会失败，因为那时发的是 'WORKFLOW'。
    expect(calls[0].params?.taskQueueType).not.toBe('WORKFLOW');
  });

  it('ACTIVITY 同样要翻译', async () => {
    const { client, calls } = stubClient({ pollers: [] });
    await handleDescribeTaskQueue(
      { task_queue: 'q', task_queue_type: 'ACTIVITY' } as never,
      client
    );
    expect(calls[0].params?.taskQueueType).toBe('TASK_QUEUE_TYPE_ACTIVITY');
  });

  it('服务端没返回 pollers 字段时，不得报成「0 个」', async () => {
    // 实测的真实形状：没有 worker 时，pollers 字段**整个不存在**。
    //   keys: ['effectiveRateLimit', 'versioningInfo']
    const { client } = stubClient({
      effectiveRateLimit: { requestsPerSecond: 4000 },
      versioningInfo: { currentVersion: '__unversioned__' },
    });
    const out = await handleDescribeTaskQueue({ task_queue: 'q' } as never, client);
    const text = (out.content[0] as { text: string }).text;

    // 这是本项目已经犯过三次的缺陷类型：把一个数写进测量字段，
    // 而那个通道什么都没测到。
    expect(text).not.toMatch(/Active Pollers:\s*0\s*$/m);
    expect(text).toContain('not reported by server');
    // 必须把三种不可区分的状态说清楚，否则读的人会当成「没有 worker」。
    expect(text).toMatch(/无法区分|not reported/);
  });

  it('服务端确实返回了 pollers 时，照常报数量', async () => {
    // 对照：有 worker 时字段存在。实测 temporal-system 的内部队列就是这样。
    const { client } = stubClient({
      pollers: [
        {
          identity: 'temporal-system@db2288637d65@temporal-system',
          lastAccessTime: '2026-09-24T11:49:35.981757462Z',
          ratePerSecond: 100000,
        },
      ],
    });
    const out = await handleDescribeTaskQueue({ task_queue: 'q' } as never, client);
    const text = (out.content[0] as { text: string }).text;

    expect(text).toContain('Active Pollers: 1');
    expect(text).not.toContain('not reported by server');
    expect(text).toContain('temporal-system@db2288637d65@temporal-system');
  });

  it('空数组与字段缺失是两件事：空数组才是真的「测到 0 个」', async () => {
    // 这一条是判据的分界线。服务端若真返回 pollers: []，
    // 那是一个有效的测量结果，报 0 是对的。
    const { client } = stubClient({ pollers: [] });
    const out = await handleDescribeTaskQueue({ task_queue: 'q' } as never, client);
    const text = (out.content[0] as { text: string }).text;

    expect(text).toContain('Active Pollers: 0');
    expect(text).not.toContain('not reported by server');
  });
});
