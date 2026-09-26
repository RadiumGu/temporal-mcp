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
    description:
      'Send a signal to a running workflow execution. Fire-and-forget: it is durably recorded even with no Worker ' +
      'online, but there is NO validator — an invalid or unauthorised signal still lands in the Event History, and ' +
      'the caller gets no result back. For anything that must be approved or refused, prefer update_workflow.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Target workflow ID.' },
        run_id: { type: 'string', description: 'Specific run ID (optional, targets latest if omitted).' },
        signal_name: { type: 'string', description: 'Signal name as registered in the workflow.' },
        input: { description: 'Signal payload. Will be JSON-encoded.' },
        identity: {
          type: 'string',
          description:
            'Who is sending this. Recorded in history for attribution. ' +
            'NOTE: caller-asserted, NOT authenticated — it attributes, it does not authorise.',
        },
        request_id: {
          type: 'string',
          description: 'Idempotency key (UUID). Re-sending the same request_id will not deliver the signal twice.',
        },
      },
      required: ['workflow_id', 'signal_name'],
    },
  },
  {
    name: 'update_workflow',
    description:
      'Send an Update to a running workflow and WAIT for its outcome. Unlike signal_workflow, an Update runs the ' +
      "workflow's validator FIRST: a rejected request never enters the Event History, and the caller gets the " +
      'rejection reason back synchronously. Use this for anything that must be approved, refused, or versioned ' +
      '(plan revisions, approvals, failover rulings). ' +
      'IMPORTANT: a rejected Update still returns HTTP 200 — read the `rejected` field, not the HTTP status. ' +
      'Requires a Worker to be online; signal_workflow does not.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Namespace containing the workflow.' },
        workflow_id: { type: 'string', description: 'Target workflow ID.' },
        run_id: { type: 'string', description: 'Specific run ID (optional, targets latest if omitted).' },
        update_name: {
          type: 'string',
          description: 'Update handler name as registered in the workflow (e.g. "revise_plan").',
        },
        input: { description: 'Update argument. Will be JSON-encoded as a single payload.' },
        identity: {
          type: 'string',
          description:
            'Who is sending this (e.g. "alice@example.com"). Recorded in history for attribution. ' +
            'NOTE: caller-asserted, NOT authenticated — it attributes, it does not authorise.',
        },
        update_id: {
          type: 'string',
          description:
            'Idempotency key. Re-sending the same update_id against the same workflow returns the ORIGINAL ' +
            "outcome instead of applying the update twice — pass it whenever the caller might retry.",
        },
        wait_stage: {
          type: 'string',
          description:
            'How long to wait: COMPLETED (default — returns the handler\'s return value) or ACCEPTED ' +
            '(returns as soon as the validator accepted, without waiting for the handler to finish).',
        },
      },
      required: ['workflow_id', 'update_name'],
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
  /** 谁发的。事后归因用 —— 注意是调用方自报，不是认证结果。 */
  identity: z.string().optional(),
  /** 幂等键。重发同一个 requestId 不会投递第二次。 */
  request_id: z.string().optional(),
});

export const updateWorkflowSchema = z.object({
  namespace: z.string().optional(),
  workflow_id: z.string(),
  run_id: z.string().optional(),
  update_name: z.string(),
  input: z.unknown().optional(),
  identity: z.string().optional(),
  update_id: z.string().optional(),
  wait_stage: z.enum(['ACCEPTED', 'COMPLETED']).optional(),
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

/**
 * Decodes whatever the HTTP gateway hands back for a query result or an Update outcome.
 *
 * ⚠️ 实测（Server 1.32.0 的 HTTP 网关，本地 dev server）：**响应体里的结果已经
 * 被解码成普通 JSON 数组**，不是请求侧那种
 * `{"payloads":[{"metadata":...,"data":"<base64>"}]}`：
 *
 *     {"queryResult":[{"state":"draft","current_version":1,...}]}
 *     {"outcome":{"success":[{"accepted":true,"version":2}]}}
 *
 * 也就是**请求与响应的 payload 形状不对称** —— 发的时候要自己 base64，
 * 收的时候不用。第一版按对称假设写，结果是"报告成功但 result 为 null"，
 * 而那正是最坏的一类错报：调用方以为拿到了 handler 的返回值。
 *
 * 两种形状都接：旧版本/其他网关若返回 payloads 形状，这里同样解得开。
 */
function decodeOutcomePayloads(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const first = value[0] as Record<string, unknown>;
    // 数组元素若仍是 payload 形状（带 base64 data），再解一层。
    if (first && typeof first === 'object' && typeof first.data === 'string' && first.metadata) {
      return decodeBase64Json(first.data as string);
    }
    return first;
  }

  const obj = value as Record<string, unknown>;
  const payloads = obj.payloads as Record<string, unknown>[] | undefined;
  if (payloads?.length && typeof payloads[0].data === 'string') {
    return decodeBase64Json(payloads[0].data as string);
  }
  // handler 返回 None：success 存在但没有内容。这是**接受**，不是拒绝。
  return null;
}

function decodeBase64Json(data: string): unknown {
  const text = Buffer.from(data, 'base64').toString('utf-8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
  if (args.identity) body.identity = args.identity;
  if (args.request_id) body.requestId = args.request_id;

  await client.post(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/signal/${encodeURIComponent(args.signal_name)}`,
    body
  );

  return {
    content: [{
      type: 'text',
      text: [
        `Signal "${args.signal_name}" sent to workflow "${args.workflow_id}" successfully.`,
        '',
        '> ⚠️ A signal has **no validator**: it is now in the Event History whether or not the workflow',
        '> considers it valid, and this call cannot tell you which. If the workflow exposes an Update',
        '> handler for the same decision, use `update_workflow` instead — it rejects before writing history',
        '> and tells you the reason.',
      ].join('\n'),
    }],
  };
}

/**
 * Sends an Update and reports its OUTCOME, not just its delivery.
 *
 * ⚠️ 这个 handler 存在的全部意义在于区分两件 HTTP 层面无法区分的事：
 *
 *   · validator **接受**了请求，handler 返回了结果      -> 200 + outcome.success
 *   · validator **拒绝**了请求，什么都没发生            -> 200 + outcome.failure
 *
 * 两者都是 HTTP 200。把后者报成「update 已发送」是最危险的一种误报：
 * 调用方会以为计划已被修订 / 审批已生效，而实际上 history 里一条都没有。
 * 所以这里把 `rejected` 作为结构化结果的第一个字段。
 */
export async function handleUpdateWorkflow(
  args: z.infer<typeof updateWorkflowSchema>,
  client: TemporalClient
): Promise<ToolResult> {
  const ns = client.ns(args.namespace);

  // 实测（1.29.7）：只发 {} 时服务端回 400 "Update meta is not set on request."
  // —— 说明 `request.meta` 是必填，且路由本身存在。
  const meta: Record<string, unknown> = {};
  if (args.update_id) meta.updateId = args.update_id;
  if (args.identity) meta.identity = args.identity;

  const input: Record<string, unknown> = { name: args.update_name };
  if (args.input !== undefined) input.args = { payloads: [encodePayload(args.input)] };

  const body: Record<string, unknown> = {
    request: { meta, input },
    waitPolicy: {
      lifecycleStage: `UPDATE_WORKFLOW_EXECUTION_LIFECYCLE_STAGE_${args.wait_stage ?? 'COMPLETED'}`,
    },
  };
  if (args.run_id) {
    body.workflowExecution = { workflowId: args.workflow_id, runId: args.run_id };
  }

  const data = await client.post<Record<string, unknown>>(
    `/api/v1/namespaces/${encodeURIComponent(ns)}/workflows/${encodeURIComponent(args.workflow_id)}/update/${encodeURIComponent(args.update_name)}`,
    body
  );

  const outcome = data.outcome as Record<string, unknown> | undefined;
  const failure = outcome?.failure as Record<string, unknown> | undefined;
  const success = outcome?.success as Record<string, unknown> | undefined;
  const updateRef = data.updateRef as Record<string, unknown> | undefined;

  const rejected = failure !== undefined;
  let resultValue: unknown;
  if (success !== undefined) {
    resultValue = decodeOutcomePayloads(success);
  }

  const lines: string[] = [
    rejected
      ? `# ❌ Update "${args.update_name}" was REJECTED — nothing was changed`
      : `# ✅ Update "${args.update_name}" accepted and applied`,
    '',
    `- Workflow: ${args.workflow_id}`,
    `- Stage reached: ${data.stage ?? 'N/A'}`,
  ];
  if (updateRef?.updateId) lines.push(`- Update ID: ${updateRef.updateId}`);
  if (args.identity) lines.push(`- Claimed identity: ${args.identity} *(caller-asserted, not authenticated)*`);

  if (rejected) {
    lines.push(
      '',
      `**Reason:** ${failure?.message ?? JSON.stringify(failure)}`,
      '',
      '> The workflow\'s validator refused this request. Nothing entered the Event History and no state',
      '> changed — this is the guard working as designed, not a transport error. Fix the request and resend.',
    );
  } else {
    lines.push('', '## Result', '```json', JSON.stringify(resultValue, null, 2), '```');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      // 第一个字段刻意是 rejected：调用方最容易漏读的就是它。
      rejected,
      updateName: args.update_name,
      workflowId: args.workflow_id,
      updateId: updateRef?.updateId ?? args.update_id ?? null,
      stage: data.stage ?? null,
      result: rejected ? null : resultValue,
      rejectionReason: rejected ? (failure?.message ?? JSON.stringify(failure)) : null,
      claimedIdentity: args.identity ?? null,
      identityIsAuthenticated: false,
    },
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

  // ⚠️ 2026-09-26 实测修正：网关返回的 queryResult 是**已解码的 JSON 数组**，
  // 不是 base64 payloads。原实现只认 payloads 形状，因此一路落到
  // `JSON.stringify(data)` 兜底 —— 调用方拿到的是整包协议报文而不是查询结果。
  const decoded = decodeOutcomePayloads(data.queryResult);
  const resultText =
    decoded === null ? JSON.stringify(data, null, 2) : JSON.stringify(decoded, null, 2);

  const lines = [
    `# Query Result: ${args.query_type}`,
    `Workflow: ${args.workflow_id}`,
    '',
    '```json',
    resultText,
    '```',
  ];

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      workflowId: args.workflow_id,
      queryType: args.query_type,
      result: decoded,
    },
  };
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
