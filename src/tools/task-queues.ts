import { z } from 'zod';
import type { TemporalClient } from '../client.js';
import type { ToolResult } from '../types.js';

export const taskQueueToolDefinitions = [
  {
    name: 'describe_task_queue',
    description:
      'Get task queue information: active pollers, backlog, and task queue type. Useful for diagnosing worker connectivity issues.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Target namespace.' },
        task_queue: { type: 'string', description: 'Task queue name.' },
        task_queue_type: {
          type: 'string',
          enum: ['WORKFLOW', 'ACTIVITY'],
          description: 'Task queue type. Defaults to WORKFLOW.',
        },
      },
      required: ['task_queue'],
    },
  },
];

export const describeTaskQueueSchema = z.object({
  namespace: z.string().optional(),
  task_queue: z.string(),
  task_queue_type: z.enum(['WORKFLOW', 'ACTIVITY']).optional(),
});

export async function handleDescribeTaskQueue(
  args: z.infer<typeof describeTaskQueueSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);

  // ⚠️ 线上格式必须是带前缀的枚举名，**不是**裸的 WORKFLOW / ACTIVITY。
  //
  // 2026-09-24 对活服务端（Temporal 1.29.7）逐个实测：
  //
  //   taskQueueType=WORKFLOW                 → {"code":3,"message":"parsing field
  //                                             \"task_queue_type\": \"WORKFLOW\"
  //                                             is not a valid value"}
  //   taskQueueType=TASK_QUEUE_TYPE_WORKFLOW → 正常返回
  //   taskQueueType=1                        → 正常返回
  //   taskQueueType=ACTIVITY                 → 同样被拒
  //   taskQueueType=TASK_QUEUE_TYPE_ACTIVITY → 正常返回
  //
  // 原来这里直接把 schema 的值（'WORKFLOW'）发上去，于是这个工具在真实
  // 服务端上**每次调用都失败**。离线比对发现不了：路径和方法都是对的，
  // 错在枚举值的写法上。
  //
  // 对外的入参保持友好的 WORKFLOW / ACTIVITY，只在发请求时翻译。
  const TASK_QUEUE_TYPE_WIRE = {
    WORKFLOW: 'TASK_QUEUE_TYPE_WORKFLOW',
    ACTIVITY: 'TASK_QUEUE_TYPE_ACTIVITY',
  } as const;

  const data = await client.get<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/task-queues/${encodeURIComponent(args.task_queue)}`,
    { taskQueueType: TASK_QUEUE_TYPE_WIRE[args.task_queue_type ?? 'WORKFLOW'] }
  );

  const lines: string[] = [`# Task Queue: ${args.task_queue}`, ''];

  // ⚠️ 区分「服务端报了 0 个 poller」与「服务端没报 poller 这件事」。
  //
  // 2026-09-24 对活服务端（Temporal 1.29.7）实测的形状：
  //
  //   有 worker 在听   keys: [effectiveRateLimit, pollers, versioningInfo]  pollers=[{...}]
  //   没有 worker      keys: [effectiveRateLimit, versioningInfo]           ← pollers 字段整个不存在
  //
  // 原来这里写 `(data.pollers ?? [])` 然后报 `Active Pollers: 0` ——
  // 那是把「什么都没测到」写成了「测到的值是 0」。三种完全不同的状态
  // 被压成同一句话：
  //
  //   ① 队列名写错了（队列不存在）
  //   ② 队列存在、没有待办、也没有 worker —— 平时的正常状态
  //   ③ 有 workflow 正在 RUNNING 等着执行，但没有 worker —— 切换卡死
  //
  // ③ 是实测出来的，不是设想：起一个 workflow 到 dr-plan-queue（无 worker），
  // 该 workflow 状态是 RUNNING，而 describe_task_queue 仍然不返回 pollers 字段。
  // 对 DR 来说 ① 和 ③ 要采取完全不同的动作，而 `0` 让它们无从区分。
  //
  // 所以字段缺失时如实说「服务端没有报」，不编一个数出来。
  const pollersReported = Object.prototype.hasOwnProperty.call(data, 'pollers');
  const pollers = (data.pollers as Record<string, unknown>[] | undefined) ?? [];

  if (!pollersReported) {
    lines.push(
      '- Active Pollers: **not reported by server**',
      '',
      '  服务端没有返回 `pollers` 字段。这**不等于**「有 0 个 worker」——',
      '  以下三种情况在本接口上返回同一个形状，无法区分：',
      '    ① 任务队列名不存在（可能是拼错）',
      '    ② 队列存在，没有 worker，也没有待办',
      '    ③ 队列上有 workflow 正在等待执行，但没有 worker 来执行',
      '  ③ 对灾备切换是故障状态，① 是配置错误 —— 请用 list_workflows',
      '  查该队列上有没有 RUNNING 的执行来进一步区分。'
    );
  } else {
    lines.push(`- Active Pollers: ${pollers.length}`);
  }

  if (pollers.length > 0) {
    lines.push('', '## Pollers');
    for (const poller of pollers) {
      lines.push(`- Identity: ${poller.identity ?? 'unknown'}`);
      if (poller.lastAccessTime) lines.push(`  Last Access: ${poller.lastAccessTime}`);
      if (poller.ratePerSecond !== undefined) lines.push(`  Rate: ${poller.ratePerSecond} tasks/s`);
    }
  }

  const taskIdBlock = data.taskIdBlock as Record<string, unknown> | undefined;
  if (taskIdBlock) {
    lines.push('', '## Task ID Block');
    if (taskIdBlock.startId !== undefined) lines.push(`- Start ID: ${taskIdBlock.startId}`);
    if (taskIdBlock.endId !== undefined) lines.push(`- End ID: ${taskIdBlock.endId}`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
