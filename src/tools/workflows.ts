import { z } from 'zod';
import type { TemporalClient } from '../client.js';
import type { ToolResult } from '../types.js';

// ─── Tool definitions (JSON Schema for MCP protocol) ─────────────────────────

export const workflowToolDefinitions = [
  {
    name: 'count_workflows',
    description:
      'Count workflow executions matching an optional visibility query. Useful for dashboards and health checks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Target namespace.' },
        query: {
          type: 'string',
          description: 'Visibility query filter (e.g. "ExecutionStatus=\'Running\'"). Leave empty to count all.',
        },
      },
      required: [],
    },
  },
  {
    name: 'pause_workflow',
    description:
      'Pause a running workflow execution. The workflow will stop scheduling new tasks until unpaused.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Workflow ID to pause.' },
        run_id: { type: 'string', description: 'Specific run ID (optional).' },
        reason: { type: 'string', description: 'Human-readable reason for pausing.' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'unpause_workflow',
    description: 'Resume a previously paused workflow execution.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Workflow ID to unpause.' },
        run_id: { type: 'string', description: 'Specific run ID (optional).' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'signal_with_start_workflow',
    description:
      'Start a workflow and send a signal atomically. If the workflow is already running, only the signal is sent. Ideal for event-driven patterns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Target namespace.' },
        workflow_id: { type: 'string', description: 'Workflow ID to start or signal.' },
        workflow_type: { type: 'string', description: 'Workflow type to start if not already running.' },
        task_queue: { type: 'string', description: 'Task queue for the workflow.' },
        signal_name: { type: 'string', description: 'Signal name to send.' },
        signal_input: { description: 'Signal payload. Will be JSON-encoded.' },
        workflow_input: { description: 'Workflow start input (used only if starting fresh).' },
      },
      required: ['workflow_id', 'workflow_type', 'task_queue', 'signal_name'],
    },
  },
  {
    name: 'list_workflows',
    description:
      'List or search workflow executions in a namespace. Supports Temporal\'s query syntax (e.g. `WorkflowType=\'OrderWorkflow\' AND ExecutionStatus=\'Running\'`). Returns status, type, start time, and IDs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: {
          type: 'string',
          description: 'Namespace to query. Defaults to the configured TEMPORAL_NAMESPACE.',
        },
        query: {
          type: 'string',
          description: 'Temporal visibility query (SQL-like filter). Leave empty to list all workflows.',
        },
        page_size: {
          type: 'number',
          description: 'Maximum number of results (default 20, max 1000).',
        },
        next_page_token: {
          type: 'string',
          description: 'Pagination cursor from a previous list_workflows call.',
        },
      },
      required: [],
    },
  },
  {
    name: 'describe_workflow',
    description:
      'Get full details for a specific workflow execution: status, workflow type, task queue, start/close time, memo, and search attributes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Workflow ID to describe.' },
        run_id: {
          type: 'string',
          description: 'Specific run ID. Omit to get the latest run.',
        },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'start_workflow',
    description:
      'Start a new workflow execution. Returns the run ID of the newly started workflow.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Target namespace.' },
        workflow_id: {
          type: 'string',
          description: 'Unique workflow ID. If a workflow with this ID already exists, behavior depends on the ID reuse policy.',
        },
        workflow_type: {
          type: 'string',
          description: 'Registered workflow type / function name.',
        },
        task_queue: {
          type: 'string',
          description: 'Task queue name where workers are polling.',
        },
        input: {
          description: 'Workflow input payload. Will be JSON-encoded.',
        },
        execution_timeout: {
          type: 'string',
          description:
            'Cap on the whole workflow including retries, e.g. "3600s". STRONGLY recommended for any workflow that mutates infrastructure — without it a stuck run hangs forever.',
        },
        run_timeout: {
          type: 'string',
          description: 'Cap on a single run, e.g. "1800s".',
        },
        task_timeout: {
          type: 'string',
          description: 'Cap on one workflow task, e.g. "30s".',
        },
        identity: {
          type: 'string',
          description: 'Who initiated this. Needed to attribute the action afterwards.',
        },
        request_id: {
          type: 'string',
          description:
            'Idempotency key (UUID). Re-sending the same request_id will NOT start a second execution — pass it whenever the caller might retry.',
        },
        memo: {
          type: 'object',
          description:
            'Non-indexed metadata attached to the execution (plan id, version, approver). Values are JSON-encoded automatically.',
        },
        search_attributes: {
          type: 'object',
          description:
            'Indexed, searchable attributes. Keys must already be registered on the server (e.g. CustomKeywordField). Values are JSON-encoded automatically.',
        },
        retry_policy: {
          type: 'object',
          description: 'e.g. { "initialInterval": "5s", "maximumAttempts": 3 }.',
        },
        id_reuse_policy: {
          type: 'string',
          description:
            'Must use the prefixed enum name, e.g. WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE. A bare value like ALLOW_DUPLICATE is rejected by the server.',
        },
      },
      required: ['workflow_id', 'workflow_type', 'task_queue'],
    },
  },
  {
    name: 'signal_workflow',
    description: 'Send a signal to a running workflow execution.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Target workflow ID.' },
        run_id: { type: 'string', description: 'Specific run ID (optional, targets latest if omitted).' },
        signal_name: { type: 'string', description: 'Signal name as registered in the workflow.' },
        input: { description: 'Signal payload. Will be JSON-encoded.' },
      },
      required: ['workflow_id', 'signal_name'],
    },
  },
  {
    name: 'query_workflow',
    description: 'Query a workflow\'s current state using a registered query handler.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Target workflow ID.' },
        run_id: { type: 'string', description: 'Specific run ID (optional).' },
        query_type: {
          type: 'string',
          description: 'Query type name as registered in the workflow (e.g. "getStatus", "__stack_trace").',
        },
        query_args: { description: 'Optional query arguments. Will be JSON-encoded.' },
      },
      required: ['workflow_id', 'query_type'],
    },
  },
  {
    name: 'cancel_workflow',
    description:
      'Request graceful cancellation of a workflow execution. The workflow will receive a CancellationRequested event and can clean up before stopping.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Workflow ID to cancel.' },
        run_id: { type: 'string', description: 'Specific run ID (optional).' },
        reason: { type: 'string', description: 'Human-readable reason for cancellation.' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'terminate_workflow',
    description:
      'Force-terminate a workflow execution immediately without cleanup. Prefer cancel_workflow when possible.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Workflow ID to terminate.' },
        run_id: { type: 'string', description: 'Specific run ID (optional).' },
        reason: {
          type: 'string',
          description: 'Reason for termination (stored in workflow history).',
        },
      },
      required: ['workflow_id'],
    },
  },
];

// ─── Zod input schemas ────────────────────────────────────────────────────────

export const countWorkflowsSchema = z.object({
  namespace: z.string().optional(),
  query: z.string().optional(),
});

export const pauseWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
  reason: z.string().optional(),
});

export const unpauseWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
});

export const signalWithStartWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  workflow_type: z.string(),
  task_queue: z.string(),
  signal_name: z.string(),
  signal_input: z.unknown().optional(),
  workflow_input: z.unknown().optional(),
});

export const listWorkflowsSchema = z.object({
  namespace: z.string().optional(),
  query: z.string().optional(),
  page_size: z.number().optional(),
  next_page_token: z.string().optional(),
});

export const describeWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
});

export const startWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  workflow_type: z.string(),
  task_queue: z.string(),
  input: z.unknown().optional(),

  // ── 以下字段 2026-09-24 补 ────────────────────────────────────────────
  //
  // 原来只发 workflowType / taskQueue / input 三个。对「启动一个会改动
  // 生产基础设施的灾备切换」来说，缺的这些都不是可选项：
  //
  //   没有超时       → 切换卡住时没有任何自动收尾，永远挂着
  //   没有 identity  → 事后查不出是谁发起的切换
  //   没有 requestId → 重试会起出第二个切换流程
  //   没有 memo      → 计划正文/版本无处附着
  //   没有 searchAttributes → 事后按「哪次演练」检索不到
  //
  // 每个字段的线上形式都对活服务端（1.29.7）实测过，不是照文档抄的。

  /** 整个 workflow（含重试）的上限，如 "3600s"。实测字段名 workflowExecutionTimeout。 */
  execution_timeout: z.string().optional(),
  /** 单次 run 的上限，如 "1800s"。实测字段名 workflowRunTimeout。 */
  run_timeout: z.string().optional(),
  /** 单个 workflow task 的上限，如 "30s"。实测字段名 workflowTaskTimeout。 */
  task_timeout: z.string().optional(),
  /** 谁发起的。DR 事后复盘要靠它。 */
  identity: z.string().optional(),
  /**
   * 幂等键。同一个 requestId 重复发不会起出第二个执行 ——
   * 对「切换命令重试」这件事是必需的。
   */
  request_id: z.string().optional(),
  /**
   * 附带的非索引元数据（计划 ID、版本、批准人）。
   * 实测形状：{fields:{<key>:{metadata,data}}}，describe 回读时是解码后的值。
   */
  memo: z.record(z.unknown()).optional(),
  /**
   * 可检索属性。键必须是服务端已注册的自定义属性名
   * （实测 CustomKeywordField 可用，服务端回读时会补上 type: Keyword）。
   */
  search_attributes: z.record(z.unknown()).optional(),
  /** 重试策略，如 { initialInterval: "5s", maximumAttempts: 3 }。 */
  retry_policy: z.record(z.unknown()).optional(),
  /**
   * 同 workflow_id 的重用策略。
   * ⚠️ 线上要带前缀，如 WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE ——
   * 裸值会被服务端拒绝（与 taskQueueType 同一个坑）。
   */
  id_reuse_policy: z.string().optional(),
});

export const signalWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
  signal_name: z.string(),
  input: z.unknown().optional(),
});

export const queryWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
  query_type: z.string(),
  query_args: z.unknown().optional(),
});

export const cancelWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
  reason: z.string().optional(),
});

export const terminateWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
  reason: z.string().optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** Formats a Temporal timestamp (RFC3339 or protobuf seconds) for display. */
function fmtTime(t: unknown): string {
  if (!t) return 'N/A';
  if (typeof t === 'string') return new Date(t).toISOString();
  if (typeof t === 'object') {
    const obj = t as Record<string, unknown>;
    if (obj.seconds) return new Date(Number(obj.seconds) * 1000).toISOString();
  }
  return String(t);
}

/** Extracts the status string from various response shapes. */
function extractStatus(exec: Record<string, unknown>): string {
  const statusCode = exec.status as string | number | undefined;
  if (!statusCode) return 'Unknown';
  // Temporal returns numeric status codes or string variants
  const statusMap: Record<string, string> = {
    '1': 'Running', '2': 'Completed', '3': 'Failed',
    '4': 'Cancelled', '5': 'Terminated', '6': 'ContinuedAsNew', '7': 'TimedOut',
    WORKFLOW_EXECUTION_STATUS_RUNNING: 'Running',
    WORKFLOW_EXECUTION_STATUS_COMPLETED: 'Completed',
    WORKFLOW_EXECUTION_STATUS_FAILED: 'Failed',
    WORKFLOW_EXECUTION_STATUS_CANCELED: 'Cancelled',
    WORKFLOW_EXECUTION_STATUS_TERMINATED: 'Terminated',
    WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW: 'ContinuedAsNew',
    WORKFLOW_EXECUTION_STATUS_TIMED_OUT: 'TimedOut',
  };
  return statusMap[String(statusCode)] ?? String(statusCode);
}

export async function handleListWorkflows(
  args: z.infer<typeof listWorkflowsSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const data = await client.get<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows`,
    {
      query: args.query,
      pageSize: args.page_size ?? 20,
      nextPageToken: args.next_page_token,
    }
  );

  const executions = (data.executions as Record<string, unknown>[] | undefined) ?? [];
  const lines: string[] = [
    `# Workflows in "${ns}" (${executions.length} returned)`,
    '',
  ];

  for (const exec of executions) {
    const execution = exec.execution as Record<string, unknown> | undefined;
    const type = exec.type as Record<string, unknown> | undefined;
    lines.push(`## ${execution?.workflowId ?? 'unknown'}`);
    lines.push(`- Run ID: ${execution?.runId ?? 'N/A'}`);
    lines.push(`- Type: ${type?.name ?? 'N/A'}`);
    lines.push(`- Status: ${extractStatus(exec)}`);
    lines.push(`- Started: ${fmtTime(exec.startTime)}`);
    if (exec.closeTime) lines.push(`- Closed: ${fmtTime(exec.closeTime)}`);
    if (exec.taskQueue) {
      const tq = exec.taskQueue as Record<string, unknown>;
      lines.push(`- Task Queue: ${tq.name ?? exec.taskQueue}`);
    }
    lines.push('');
  }

  if (data.nextPageToken) {
    lines.push(`*Next page token: ${data.nextPageToken}*`);
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      namespace: ns,
      count: executions.length,
      workflows: executions.map((exec) => {
        const execution = exec.execution as Record<string, unknown> | undefined;
        const type = exec.type as Record<string, unknown> | undefined;
        return {
          workflowId: execution?.workflowId,
          runId: execution?.runId,
          type: type?.name,
          status: extractStatus(exec),
          startTime: exec.startTime,
          closeTime: exec.closeTime,
        };
      }),
      nextPageToken: data.nextPageToken,
    },
  };
}

export async function handleDescribeWorkflow(
  args: z.infer<typeof describeWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const params: Record<string, string | undefined> = {};
  if (args.run_id) params['execution.runId'] = args.run_id;

  const data = await client.get<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}`,
    params
  );

  const execInfo = data.workflowExecutionInfo as Record<string, unknown> | undefined;
  const execution = execInfo?.execution as Record<string, unknown> | undefined;
  const type = execInfo?.type as Record<string, unknown> | undefined;
  const pendingActs = data.pendingActivities as unknown[] | undefined;
  const pendingChildren = data.pendingChildren as unknown[] | undefined;

  const lines: string[] = [
    `# Workflow: ${execution?.workflowId ?? args.workflow_id}`,
    '',
  ];

  if (execution?.runId) lines.push(`- Run ID: ${execution.runId}`);
  if (type?.name) lines.push(`- Type: ${type.name}`);
  if (execInfo) lines.push(`- Status: ${extractStatus(execInfo)}`);
  if (execInfo?.startTime) lines.push(`- Started: ${fmtTime(execInfo.startTime)}`);
  if (execInfo?.closeTime) lines.push(`- Closed: ${fmtTime(execInfo.closeTime)}`);
  if (execInfo?.taskQueue) {
    const tq = execInfo.taskQueue as Record<string, unknown>;
    lines.push(`- Task Queue: ${tq.name ?? execInfo.taskQueue}`);
  }
  if (execInfo?.historyLength) lines.push(`- History Events: ${execInfo.historyLength}`);

  if (pendingActs?.length) {
    lines.push('', `## Pending Activities (${pendingActs.length})`);
    for (const act of pendingActs) {
      const a = act as Record<string, unknown>;
      lines.push(`- ${a.activityId}: ${(a.activityType as Record<string, unknown>)?.name ?? 'unknown'} [${a.state ?? ''}]`);
    }
  }

  if (pendingChildren?.length) {
    lines.push('', `## Pending Child Workflows (${pendingChildren.length})`);
    for (const child of pendingChildren) {
      const c = child as Record<string, unknown>;
      lines.push(`- ${c.workflowId}: ${(c.workflowTypeName as string) ?? 'unknown'}`);
    }
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      workflowId: execution?.workflowId,
      runId: execution?.runId,
      type: type?.name,
      status: execInfo ? extractStatus(execInfo) : undefined,
      startTime: execInfo?.startTime,
      closeTime: execInfo?.closeTime,
      taskQueue: (() => { const tq = execInfo?.taskQueue as Record<string, unknown> | undefined; return tq?.name ?? execInfo?.taskQueue; })(),
      historyLength: execInfo?.historyLength,
      pendingActivities: pendingActs?.length ?? 0,
      pendingChildren: pendingChildren?.length ?? 0,
    },
  };
}

/** Encodes a value as a Temporal payload (base64 JSON). */
function encodePayload(value: unknown): { metadata: { encoding: string }; data: string } {
  const json = JSON.stringify(value);
  const b64 = Buffer.from(json).toString('base64');
  return {
    metadata: { encoding: Buffer.from('json/plain').toString('base64') },
    data: b64,
  };
}

export async function handleStartWorkflow(
  args: z.infer<typeof startWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {
    workflowType: { name: args.workflow_type },
    taskQueue: { name: args.task_queue },
  };

  if (args.input !== undefined) {
    body.input = { payloads: [encodePayload(args.input)] };
  }

  // ── 下面这些字段的线上名都是对活服务端实测确认的 ──────────────────────
  //
  // 服务端对未知字段是**硬拒绝**而不是静默丢弃，实测：
  //   {"code":3,"message":"temporalproto: (line 1:55): unknown field
  //    \"totallyBogusField\""}
  // 所以名字写错会响亮地失败 —— 这比静默丢弃安全得多，但也意味着
  // 这里每一个名字都必须是对的。

  if (args.execution_timeout) body.workflowExecutionTimeout = args.execution_timeout;
  if (args.run_timeout) body.workflowRunTimeout = args.run_timeout;
  if (args.task_timeout) body.workflowTaskTimeout = args.task_timeout;
  if (args.identity) body.identity = args.identity;
  if (args.request_id) body.requestId = args.request_id;
  if (args.id_reuse_policy) body.workflowIdReusePolicy = args.id_reuse_policy;
  if (args.retry_policy) body.retryPolicy = args.retry_policy;

  // memo / searchAttributes 的值都要包成 payload，不能直接放原值。
  // 实测回读：memo 是解码后的值，searchAttributes 是原 payload 外加
  // 服务端补的 type 字段。
  if (args.memo) {
    body.memo = {
      fields: Object.fromEntries(
        Object.entries(args.memo).map(([k, v]) => [k, encodePayload(v)])
      ),
    };
  }
  if (args.search_attributes) {
    body.searchAttributes = {
      indexedFields: Object.fromEntries(
        Object.entries(args.search_attributes).map(([k, v]) => [k, encodePayload(v)])
      ),
    };
  }

  const data = await client.post<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}`,
    body
  );

  const lines = [
    `# Workflow Started`,
    `- Workflow ID: ${args.workflow_id}`,
    `- Run ID: ${data.runId ?? 'N/A'}`,
    `- Started: ${data.started !== undefined ? data.started : 'yes'}`,
  ];

  // ⚠️ 启动成功 ≠ 切换正在进行。
  //
  // 实测（1.29.7）：在**没有任何 worker** 的任务队列上起 workflow 也会
  // 返回 started:true / status:RUNNING。那个执行会一直挂着等一个不存在
  // 的 worker，直到保留期到点被清掉。
  //
  // 对灾备切换来说，把 started:true 当作「切换已启动」是危险的误读，
  // 所以这里主动提醒下一步必须独立确认有 worker 接单。
  lines.push(
    '',
    '> ⚠️ `started: true` 只表示服务端受理了这次启动，**不表示有 worker 在执行**。',
    '> 实测：无 worker 的队列同样返回 `started: true` / `RUNNING`，执行会一直挂着。',
    `> 请用 \`describe_task_queue\` 查 \`${args.task_queue}\` 是否真的返回了 pollers 字段。`
  );

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function handleSignalWorkflow(
  args: z.infer<typeof signalWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {};
  if (args.run_id) body['workflowExecution'] = { workflowId: args.workflow_id, runId: args.run_id };
  if (args.input !== undefined) body.input = { payloads: [encodePayload(args.input)] };

  await client.post(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/signal/${encodeURIComponent(args.signal_name)}`,
    body
  );

  return {
    content: [{
      type: 'text',
      text: `Signal "${args.signal_name}" sent to workflow "${args.workflow_id}" successfully.`,
    }],
  };
}

export async function handleQueryWorkflow(
  args: z.infer<typeof queryWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {};
  if (args.run_id) body.execution = { workflowId: args.workflow_id, runId: args.run_id };
  if (args.query_args !== undefined) body.query = { queryArgs: { payloads: [encodePayload(args.query_args)] } };

  const data = await client.post<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/query/${encodeURIComponent(args.query_type)}`,
    body
  );

  const result = data.queryResult as Record<string, unknown> | undefined;
  const payloads = result?.payloads as unknown[] | undefined;

  let resultText = JSON.stringify(data, null, 2);
  if (payloads?.length) {
    try {
      const payload = payloads[0] as Record<string, unknown>;
      if (payload.data) {
        const decoded = Buffer.from(payload.data as string, 'base64').toString('utf-8');
        resultText = decoded;
      }
    } catch {
      // fall back to raw JSON
    }
  }

  const lines = [
    `# Query Result: ${args.query_type}`,
    `Workflow: ${args.workflow_id}`,
    '',
    '```json',
    resultText,
    '```',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export async function handleCancelWorkflow(
  args: z.infer<typeof cancelWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {};
  if (args.run_id) body.workflowExecution = { workflowId: args.workflow_id, runId: args.run_id };
  if (args.reason) body.reason = args.reason;

  await client.post(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/cancel`,
    body
  );

  return {
    content: [{
      type: 'text',
      text: `Cancellation requested for workflow "${args.workflow_id}"${args.reason ? ` (reason: ${args.reason})` : ''}.`,
    }],
  };
}

export async function handleTerminateWorkflow(
  args: z.infer<typeof terminateWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {};
  if (args.run_id) body.workflowExecution = { workflowId: args.workflow_id, runId: args.run_id };
  if (args.reason) body.reason = args.reason;

  await client.post(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/terminate`,
    body
  );

  return {
    content: [{
      type: 'text',
      text: `Workflow "${args.workflow_id}" terminated${args.reason ? ` (reason: ${args.reason})` : ''}.`,
    }],
  };
}

export async function handleCountWorkflows(
  args: z.infer<typeof countWorkflowsSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const data = await client.get<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflow-count`,
    { query: args.query }
  );

  const count = data.count ?? 0;
  const groups = data.groups as Record<string, unknown>[] | undefined;

  const lines = [
    `# Workflow Count in "${ns}"`,
    '',
    `Total: **${count}**`,
  ];

  if (groups?.length) {
    lines.push('', '## Breakdown');
    for (const g of groups) {
      const groupValues = g.groupValues as Record<string, unknown>[] | undefined;
      const label = groupValues?.map((v) => v.data ?? v).join(', ') ?? JSON.stringify(g);
      lines.push(`- ${label}: ${g.count}`);
    }
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      namespace: ns,
      count: Number(count),
      query: args.query ?? null,
      groups: groups?.map((g) => ({
        count: g.count,
        groupValues: g.groupValues,
      })) ?? [],
    },
  };
}

export async function handlePauseWorkflow(
  args: z.infer<typeof pauseWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {};
  if (args.run_id) body.workflowExecution = { workflowId: args.workflow_id, runId: args.run_id };
  if (args.reason) body.reason = args.reason;

  await client.post(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/pause`,
    body
  );

  return {
    content: [{
      type: 'text',
      text: `Workflow "${args.workflow_id}" paused${args.reason ? ` (reason: ${args.reason})` : ''}.`,
    }],
  };
}

export async function handleUnpauseWorkflow(
  args: z.infer<typeof unpauseWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {};
  if (args.run_id) body.workflowExecution = { workflowId: args.workflow_id, runId: args.run_id };

  await client.post(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/unpause`,
    body
  );

  return {
    content: [{ type: 'text', text: `Workflow "${args.workflow_id}" unpaused.` }],
  };
}

export async function handleSignalWithStartWorkflow(
  args: z.infer<typeof signalWithStartWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);
  const body: Record<string, unknown> = {
    workflowType: { name: args.workflow_type },
    taskQueue: { name: args.task_queue },
    signalName: args.signal_name,
  };

  if (args.signal_input !== undefined) body.signalInput = { payloads: [encodePayload(args.signal_input)] };
  if (args.workflow_input !== undefined) body.input = { payloads: [encodePayload(args.workflow_input)] };

  const data = await client.post<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/signal-with-start/${encodeURIComponent(args.signal_name)}`,
    body
  );

  return {
    content: [{
      type: 'text',
      text: [
        `# signal_with_start: "${args.workflow_id}"`,
        `- Signal: ${args.signal_name}`,
        `- Run ID: ${data.runId ?? 'N/A'}`,
        `- Started: ${data.started !== undefined ? data.started : 'yes (or already running)'}`,
      ].join('\n'),
    }],
  };
}
