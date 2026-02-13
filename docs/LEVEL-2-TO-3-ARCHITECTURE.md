# Level 2 → Level 3 Architecture: Design + Orchestrate

> **FlowGrid Platform Evolution**
> Author: CHEF (Architecture Assistant)
> Date: 2026-02-13
> Status: Draft
> Version: 1.0

## Executive Summary

Level 3 transforms FlowGrid from a design-and-export tool into a **live orchestration platform**. Instead of generating code for users to deploy elsewhere, FlowGrid **runs BPMN processes itself** — executing flows, dispatching tasks to agents (LLM calls), managing human-in-the-loop approvals, and tracking state.

FlowGrid becomes the **control plane** for multi-agent systems. Agent execution (LLM inference) is delegated externally, but FlowGrid owns:
- **Flow orchestration** (BPMN runtime)
- **State management** (shared state store)
- **Human interaction** (approval queues, multi-channel delivery)
- **Event routing** (agent-to-agent communication)
- **Task dispatch** (reliable queue with retry/DLQ)
- **Observability** (execution traces, dashboards)

This is analogous to **ServiceNow's workflow engine** but purpose-built for AI agent orchestration.

---

## 1. Orchestrator Engine

### 1.1 Engine Selection: bpmn-engine vs Camunda Zeebe

| Criteria | bpmn-engine (Node.js) | Camunda Zeebe |
|---|---|---|
| Language | JavaScript/TypeScript | Java (gRPC clients for Node) |
| Deployment | Embedded in Node process | Separate cluster (3+ nodes) |
| Complexity | Low — npm package | High — Kubernetes, Elasticsearch |
| BPMN coverage | Core (tasks, gateways, events) | Full BPMN 2.0 + CMMN + DMN |
| Scalability | Single process, Redis for distribution | Horizontally scalable, partitioned |
| Persistence | Custom (we control it) | Built-in (RocksDB + Elasticsearch) |
| Ops overhead | Minimal | Significant (JVM tuning, cluster mgmt) |
| License | MIT | Community: source-available |
| Fit for FlowGrid | ✅ Perfect for L3 MVP | Overkill until >1000 concurrent flows |

**Recommendation: `bpmn-engine` for Level 3.**

Reasons:
1. Same tech stack (Node.js/TypeScript) — no Java dependency
2. Embeddable — runs inside our orchestrator-service
3. Full control over persistence, state, and execution
4. Sufficient BPMN coverage for agent orchestration patterns
5. If we outgrow it, migrate to Zeebe at Level 4

**Migration path:** Abstract the engine behind an `OrchestratorEngine` interface so Zeebe can be swapped in later.

### 1.2 Engine Architecture

```typescript
// orchestrator/engine.interface.ts
interface OrchestratorEngine {
  /**
   * Deploy a BPMN process definition.
   */
  deploy(bpmnXml: string, metadata: ProcessMetadata): Promise<DeploymentResult>;

  /**
   * Start a new process instance.
   */
  startInstance(
    processId: string,
    variables: Record<string, unknown>,
    tenantId: string,
  ): Promise<ProcessInstance>;

  /**
   * Signal a waiting task (e.g., after HITL approval).
   */
  signal(instanceId: string, taskId: string, payload: unknown): Promise<void>;

  /**
   * Cancel a running instance.
   */
  cancel(instanceId: string, reason: string): Promise<void>;

  /**
   * Get instance state.
   */
  getState(instanceId: string): Promise<ProcessInstanceState>;

  /**
   * Register a task handler for service tasks.
   */
  registerTaskHandler(taskType: string, handler: TaskHandler): void;
}

type TaskHandler = (task: TaskContext) => Promise<TaskResult>;

interface TaskContext {
  instanceId: string;
  taskId: string;
  taskType: string;           // maps to agent slug or tool
  variables: Record<string, unknown>;
  tenantId: string;
  retryCount: number;
}
```

### 1.3 BPMN Service Task → Agent Invocation

When the BPMN engine reaches a Service Task, it:

1. Resolves the task type to an agent (via task definition mapping)
2. Enqueues an agent execution job to the **Task Queue**
3. Suspends the process instance (waiting for task completion)
4. When the agent completes, resumes the instance with output variables

```typescript
// orchestrator/handlers/agent-task-handler.ts
import { Engine } from 'bpmn-engine';
import { taskQueue } from '../queues/task-queue';
import { stateStore } from '../state/state-store';

export function registerAgentTaskHandlers(engine: Engine) {
  engine.on('activity.start', async (api, execution) => {
    const element = api.content;

    if (element.type === 'bpmn:ServiceTask') {
      const agentSlug = element.behaviour?.implementation;  // e.g., "agent:classifier"
      const taskType = element.behaviour?.taskDefinition?.type;

      if (agentSlug?.startsWith('agent:')) {
        // Suspend BPMN and dispatch to task queue
        api.content.isWaiting = true;

        const variables = await stateStore.getFlowState(execution.id);

        await taskQueue.enqueue({
          instanceId: execution.id,
          taskId: element.id,
          agentSlug: agentSlug.replace('agent:', ''),
          variables,
          tenantId: execution.environment.variables.tenantId,
          priority: element.behaviour?.priority || 'normal',
        });
      }
    }
  });
}
```

### 1.4 Process Lifecycle

```
                    deploy()
                       │
                       ▼
              ┌─────────────────┐
              │    DEPLOYED      │  (BPMN parsed & stored)
              └────────┬────────┘
                       │ startInstance()
                       ▼
              ┌─────────────────┐
              │    RUNNING       │◀──────────────────┐
              └────────┬────────┘                    │
                       │                             │
            ┌──────────┼──────────┐                  │
            ▼          ▼          ▼                   │
     ┌───────────┐ ┌────────┐ ┌────────┐            │
     │ TASK      │ │ HITL   │ │ EVENT  │            │
     │ EXECUTING │ │ WAITING│ │ WAITING│            │
     └─────┬─────┘ └───┬────┘ └───┬────┘            │
           │            │          │                  │
           │   signal() │  signal()│                  │
           └────────────┴──────────┘                  │
                       │                              │
                       ├──── (more tasks) ────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   COMPLETED      │
              └─────────────────┘
                  or FAILED / CANCELLED
```

---

## 2. Interaction Service (HITL / HOTL / HITM)

### 2.1 Interaction Model

Three interaction patterns, modeled after ServiceNow approval workflows:

| Pattern | Acronym | Description | Example |
|---|---|---|---|
| Human-in-the-Loop | HITL | Human must approve before continuing | "Approve this deployment plan" |
| Human-on-the-Loop | HOTL | Human monitors, can intervene | "Agent is resolving — click to override" |
| Human-in-the-Middle | HITM | Human performs a step agents can't | "Physically verify the server rack" |

### 2.2 Approval Queue Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Interaction Service (:3006)                 │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Approval     │  │ SLA Tracker  │  │ Escalation Engine   │ │
│  │ Queue        │  │              │  │                     │ │
│  │              │  │ • Timeout    │  │ • L1 → L2 → L3     │ │
│  │ • Create     │  │   monitoring │  │ • Auto-approve      │ │
│  │ • Assign     │  │ • SLA breach │  │ • Delegation        │ │
│  │ • Complete   │  │   alerts     │  │ • Group approval    │ │
│  │ • Escalate   │  │ • Metrics    │  │                     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                 │                      │             │
│         └─────────────────┼──────────────────────┘             │
│                           │                                    │
│                    ┌──────▼───────┐                            │
│                    │   Channel    │                            │
│                    │   Gateway    │                            │
│                    └──────┬───────┘                            │
│                           │                                    │
└───────────────────────────┼────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Slack   │ │  Teams   │ │  Email   │
        │  Bot     │ │ Adaptive │ │  + Web   │
        │          │ │  Cards   │ │  UI      │
        └──────────┘ └──────────┘ └──────────┘
```

### 2.3 Approval Flow (ServiceNow-inspired)

```typescript
// interaction/approval.ts
interface ApprovalRequest {
  id: string;
  instanceId: string;           // BPMN process instance
  taskId: string;               // BPMN user task
  tenantId: string;

  // What needs approval
  type: 'approve_reject' | 'review_edit' | 'inform' | 'manual_task';
  title: string;
  description: string;
  context: Record<string, unknown>;   // state snapshot for human review
  editableFields?: string[];          // fields the human can modify

  // Who approves
  assignmentRule: AssignmentRule;
  assignedTo?: string;                // resolved user/group
  approvalGroup?: string;             // group approval

  // SLA
  sla: {
    responseTime: number;             // seconds — must acknowledge
    resolutionTime: number;           // seconds — must complete
    breachAction: 'escalate' | 'auto_approve' | 'auto_reject' | 'notify';
  };

  // Escalation chain
  escalation: EscalationChain;

  // Delivery
  channels: ('slack' | 'teams' | 'email' | 'web')[];
  priority: 'low' | 'normal' | 'high' | 'critical';

  // State
  status: 'pending' | 'assigned' | 'in_progress' | 'approved' | 'rejected' | 'escalated' | 'expired';
  createdAt: Date;
  acknowledgedAt?: Date;
  completedAt?: Date;
  completedBy?: string;
  response?: ApprovalResponse;
}

interface EscalationChain {
  levels: Array<{
    level: number;
    afterSeconds: number;
    assignTo: string;               // user or group
    notifyChannels: string[];
  }>;
  maxLevel: number;
  finalAction: 'auto_approve' | 'auto_reject' | 'cancel_flow';
}

interface AssignmentRule {
  type: 'user' | 'group' | 'role' | 'round_robin' | 'least_busy';
  value: string;                    // user id, group id, or role name
}
```

### 2.4 SLA Tracking

```typescript
// interaction/sla-tracker.ts
import { CronJob } from 'cron';

class SLATracker {
  private checkInterval = 30_000; // 30 seconds

  async checkBreaches(): Promise<void> {
    const pendingApprovals = await db.query(`
      SELECT * FROM approval_requests
      WHERE status IN ('pending', 'assigned', 'in_progress')
        AND (
          (acknowledged_at IS NULL AND created_at + (sla->>'responseTime')::int * interval '1 second' < NOW())
          OR
          (completed_at IS NULL AND created_at + (sla->>'resolutionTime')::int * interval '1 second' < NOW())
        )
    `);

    for (const approval of pendingApprovals) {
      await this.handleBreach(approval);
    }
  }

  private async handleBreach(approval: ApprovalRequest): Promise<void> {
    const breachAction = approval.sla.breachAction;

    switch (breachAction) {
      case 'escalate':
        await this.escalate(approval);
        break;
      case 'auto_approve':
        await this.autoComplete(approval, 'approved');
        break;
      case 'auto_reject':
        await this.autoComplete(approval, 'rejected');
        break;
      case 'notify':
        await this.notifyBreach(approval);
        break;
    }

    await eventBus.publish('sla.breached', {
      approvalId: approval.id,
      instanceId: approval.instanceId,
      breachType: !approval.acknowledgedAt ? 'response' : 'resolution',
    });
  }

  private async escalate(approval: ApprovalRequest): Promise<void> {
    const currentLevel = approval.escalation.levels.findIndex(
      l => l.assignTo === approval.assignedTo
    );
    const nextLevel = approval.escalation.levels[currentLevel + 1];

    if (nextLevel) {
      await db.query(`
        UPDATE approval_requests
        SET assigned_to = $1, status = 'escalated', escalation_level = $2
        WHERE id = $3
      `, [nextLevel.assignTo, nextLevel.level, approval.id]);

      await channelGateway.deliver(nextLevel.assignTo, {
        type: 'escalation',
        approval,
        channels: nextLevel.notifyChannels,
      });
    } else {
      // Max escalation reached
      await this.handleFinalAction(approval);
    }
  }
}
```

---

## 3. Shared State Store

### 3.1 State Hierarchy

```
┌─────────────────────────────────────────────┐
│              Global State                    │
│  (cross-flow, tenant-level shared data)     │
│                                              │
│  ┌───────────────────────────────────────┐  │
│  │          Flow Instance State           │  │
│  │  (per process instance)               │  │
│  │                                        │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │       Agent Task State          │  │  │
│  │  │  (per agent execution within    │  │  │
│  │  │   a flow instance)              │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 3.2 PostgreSQL Schema

```sql
-- Flow instance state (main state document per running flow)
CREATE TABLE flow_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES process_instances(id),
    version INTEGER NOT NULL DEFAULT 1,          -- optimistic concurrency
    state JSONB NOT NULL DEFAULT '{}',           -- the actual state data
    checksum VARCHAR(64) NOT NULL,               -- SHA-256 of state for integrity
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL,

    UNIQUE(instance_id, version)
);

-- State history for audit trail / time-travel debugging
CREATE TABLE flow_state_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL,
    version INTEGER NOT NULL,
    state JSONB NOT NULL,
    changed_by VARCHAR(200) NOT NULL,            -- agent slug or user id
    change_reason VARCHAR(500),                  -- task id, approval id, etc.
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL
);

CREATE INDEX idx_state_history_instance ON flow_state_history(instance_id, version);

-- Agent-scoped state (persists across invocations within a flow)
CREATE TABLE agent_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES process_instances(id),
    agent_slug VARCHAR(100) NOT NULL,
    state JSONB NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL,

    UNIQUE(instance_id, agent_slug)
);

-- Global state (tenant-level, cross-flow)
CREATE TABLE global_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    namespace VARCHAR(200) NOT NULL,             -- e.g., "knowledge_base", "config"
    state JSONB NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, namespace)
);
```

### 3.3 Concurrency Control

```typescript
// state/state-store.ts
class StateStore {
  /**
   * Update flow state with optimistic concurrency control.
   * Throws ConflictError if version mismatch.
   */
  async updateFlowState(
    instanceId: string,
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
    expectedVersion: number,
  ): Promise<FlowState> {
    return await db.transaction(async (tx) => {
      // Lock the row
      const current = await tx.query(`
        SELECT * FROM flow_states
        WHERE instance_id = $1
        FOR UPDATE
      `, [instanceId]);

      if (current.version !== expectedVersion) {
        throw new ConflictError(
          `State version conflict: expected ${expectedVersion}, got ${current.version}`
        );
      }

      const newState = updater(current.state);
      const newVersion = current.version + 1;

      // Write new version
      await tx.query(`
        UPDATE flow_states
        SET state = $1, version = $2, checksum = $3, updated_at = NOW()
        WHERE instance_id = $4
      `, [newState, newVersion, sha256(newState), instanceId]);

      // Write history
      await tx.query(`
        INSERT INTO flow_state_history (instance_id, version, state, changed_by, change_reason)
        VALUES ($1, $2, $3, $4, $5)
      `, [instanceId, newVersion, newState, /* context */]);

      return { state: newState, version: newVersion };
    });
  }
}
```

---

## 4. Event Bus

### 4.1 Architecture

Redis Streams-based event bus with PostgreSQL event store for durability:

```
┌─────────────────────────────────────────────────────┐
│                    Event Bus                         │
│                                                      │
│  ┌──────────────┐    ┌───────────────────────────┐  │
│  │ Redis Streams │    │ PostgreSQL Event Store    │  │
│  │ (hot path)   │    │ (durable, queryable)      │  │
│  │              │    │                            │  │
│  │ • Pub/Sub    │───▶│ • All events persisted    │  │
│  │ • Consumer   │    │ • Event sourcing ready    │  │
│  │   groups     │    │ • Audit trail             │  │
│  │ • At-least-  │    │ • Replay capability       │  │
│  │   once       │    │                            │  │
│  └──────────────┘    └───────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 4.2 Event Schema

```typescript
interface FlowGridEvent {
  id: string;                    // UUID
  type: string;                  // dot-notation: "flow.started", "agent.completed"
  source: string;                // service that emitted: "orchestrator", "agent-executor"
  instanceId?: string;           // flow instance
  tenantId: string;
  timestamp: Date;
  data: Record<string, unknown>;
  correlationId?: string;        // for request tracing
  causationId?: string;          // event that caused this event
}

// Event types:
// flow.deployed, flow.started, flow.completed, flow.failed, flow.cancelled
// task.dispatched, task.started, task.completed, task.failed, task.retried
// agent.invoked, agent.completed, agent.error, agent.tool_called
// approval.created, approval.assigned, approval.completed, approval.escalated, approval.expired
// sla.warning, sla.breached
// state.updated
```

### 4.3 Implementation

```typescript
// events/event-bus.ts
import Redis from 'ioredis';

class EventBus {
  private redis: Redis;
  private subscribers = new Map<string, Set<EventHandler>>();

  async publish(type: string, data: Record<string, unknown>, context?: EventContext): Promise<string> {
    const event: FlowGridEvent = {
      id: uuid(),
      type,
      source: context?.source || 'unknown',
      instanceId: context?.instanceId,
      tenantId: context?.tenantId || '',
      timestamp: new Date(),
      data,
      correlationId: context?.correlationId,
    };

    // Hot path: Redis Stream
    await this.redis.xadd(
      `events:${type.split('.')[0]}`,  // e.g., events:flow, events:agent
      '*',
      'event', JSON.stringify(event),
    );

    // Cold path: PostgreSQL (async, non-blocking)
    setImmediate(() => this.persistEvent(event));

    return event.id;
  }

  async subscribe(pattern: string, handler: EventHandler, group?: string): Promise<void> {
    // Consumer group for reliable processing
    const streamKey = `events:${pattern.split('.')[0]}`;

    if (group) {
      // Create consumer group if not exists
      try {
        await this.redis.xgroup('CREATE', streamKey, group, '0', 'MKSTREAM');
      } catch { /* group exists */ }
    }

    // Start consuming
    this.consumeStream(streamKey, group, pattern, handler);
  }

  private async persistEvent(event: FlowGridEvent): Promise<void> {
    await db.query(`
      INSERT INTO events (id, type, source, instance_id, tenant_id, timestamp, data, correlation_id, causation_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [event.id, event.type, event.source, event.instanceId, event.tenantId,
        event.timestamp, event.data, event.correlationId, event.causationId]);
  }
}
```

### 4.4 Event Store (PostgreSQL)

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY,
    type VARCHAR(200) NOT NULL,
    source VARCHAR(100) NOT NULL,
    instance_id UUID,
    tenant_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL,
    correlation_id UUID,
    causation_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(type, timestamp);
CREATE INDEX idx_events_instance ON events(instance_id, timestamp);
CREATE INDEX idx_events_tenant ON events(tenant_id, timestamp);
CREATE INDEX idx_events_correlation ON events(correlation_id);
```

---

## 5. Task Queue

### 5.1 Architecture

BullMQ (Redis-backed) for reliable task dispatch:

```
┌─────────────────────────────────────────────────────────────┐
│                       Task Queue (BullMQ)                    │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐│
│  │  Priority   │  │  Standard  │  │  Background            ││
│  │  Queue      │  │  Queue     │  │  Queue                 ││
│  │  (critical) │  │  (normal)  │  │  (low priority)        ││
│  └─────┬──────┘  └─────┬──────┘  └─────────┬──────────────┘│
│        │               │                    │                │
│        └───────────────┬┘────────────────────┘                │
│                        │                                      │
│                 ┌──────▼──────┐                               │
│                 │   Workers   │                               │
│                 │  (N procs)  │                               │
│                 └──────┬──────┘                               │
│                        │                                      │
│              ┌─────────┼─────────┐                           │
│              ▼         ▼         ▼                           │
│        ┌──────────┐ ┌──────┐ ┌──────┐                      │
│        │  Retry   │ │ DLQ  │ │ Done │                      │
│        │  Queue   │ │      │ │      │                      │
│        └──────────┘ └──────┘ └──────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Implementation

```typescript
// queues/task-queue.ts
import { Queue, Worker, Job } from 'bullmq';

const QUEUE_NAME = 'agent-tasks';

const taskQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,        // 5s, 10s, 20s
    },
    removeOnComplete: { age: 86400 },  // keep 24h
    removeOnFail: false,               // keep in DLQ forever
  },
});

interface AgentTaskPayload {
  instanceId: string;
  taskId: string;
  agentSlug: string;
  variables: Record<string, unknown>;
  tenantId: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  timeout: number;           // ms
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
}

// Enqueue
async function enqueueAgentTask(payload: AgentTaskPayload): Promise<Job> {
  const priorityMap = { critical: 1, high: 2, normal: 3, low: 4 };

  return taskQueue.add('execute-agent', payload, {
    priority: priorityMap[payload.priority],
    jobId: `${payload.instanceId}:${payload.taskId}`,
    attempts: payload.retryPolicy?.maxAttempts || 3,
  });
}

// Worker
const worker = new Worker(QUEUE_NAME, async (job: Job<AgentTaskPayload>) => {
  const { agentSlug, variables, tenantId, instanceId, taskId } = job.data;

  await eventBus.publish('task.started', { agentSlug, taskId }, { instanceId, tenantId });

  try {
    // Delegate to agent executor
    const result = await agentExecutor.execute({
      agentSlug,
      variables,
      tenantId,
      timeout: job.data.timeout,
    });

    // Report completion back to orchestrator
    await orchestratorEngine.signal(instanceId, taskId, result);

    await eventBus.publish('task.completed', {
      agentSlug, taskId, duration: Date.now() - job.processedOn!,
    }, { instanceId, tenantId });

    return result;

  } catch (error) {
    await eventBus.publish('task.failed', {
      agentSlug, taskId, error: error.message, attempt: job.attemptsMade,
    }, { instanceId, tenantId });

    throw error; // BullMQ handles retry
  }
}, {
  connection: redisConnection,
  concurrency: 10,
  limiter: {
    max: 50,
    duration: 60_000,      // 50 tasks per minute (rate limit LLM calls)
  },
});

// Dead Letter Queue monitoring
worker.on('failed', async (job, error) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
    await eventBus.publish('task.dead_letter', {
      agentSlug: job.data.agentSlug,
      taskId: job.data.taskId,
      error: error.message,
      attempts: job.attemptsMade,
    }, { instanceId: job.data.instanceId, tenantId: job.data.tenantId });

    // Notify ops team
    await channelGateway.deliver('ops-team', {
      type: 'dlq_alert',
      message: `Agent task failed permanently: ${job.data.agentSlug} in flow ${job.data.instanceId}`,
      channels: ['slack', 'email'],
    });
  }
});
```

---

## 6. Channel Gateway

### 6.1 Multi-Channel Delivery

```
┌──────────────────────────────────────────────────────────────┐
│                   Channel Gateway (:3007)                      │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                 Message Router                           │  │
│  │  • User preferences (preferred channel per user)        │  │
│  │  • Fallback chain (Slack → Teams → Email)              │  │
│  │  • Priority routing (critical → all channels)          │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                           │                                    │
│           ┌───────────────┼───────────────┐                   │
│           ▼               ▼               ▼                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐         │
│  │ Slack       │  │ Teams       │  │ Email        │         │
│  │ Adapter     │  │ Adapter     │  │ Adapter      │         │
│  │             │  │             │  │              │         │
│  │ • Webhooks  │  │ • Adaptive  │  │ • SMTP /    │         │
│  │ • Bolt SDK  │  │   Cards     │  │   SendGrid  │         │
│  │ • Blocks    │  │ • Bot       │  │ • Templates │         │
│  │ • Buttons   │  │   Framework │  │ • HTML      │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘         │
│         │                │                │                   │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼───────┐         │
│  │ Callback    │  │ Callback    │  │ Callback     │         │
│  │ Handler     │  │ Handler     │  │ Handler      │         │
│  │ (webhooks)  │  │ (webhooks)  │  │ (reply-to)   │         │
│  └─────────────┘  └─────────────┘  └──────────────┘         │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Web UI Adapter (WebSocket)                  │  │
│  │  • Real-time approval notifications                     │  │
│  │  • In-app approval queue                                │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Channel Adapter Interface

```typescript
interface ChannelAdapter {
  readonly name: string;
  readonly supportedActions: ('notify' | 'approval' | 'status' | 'escalation')[];

  /**
   * Send an approval request to a user.
   * Returns a delivery receipt for tracking.
   */
  sendApproval(request: ApprovalDelivery): Promise<DeliveryReceipt>;

  /**
   * Send a notification (no response expected).
   */
  sendNotification(notification: NotificationDelivery): Promise<DeliveryReceipt>;

  /**
   * Handle incoming callback (button click, reply, etc.).
   */
  handleCallback(callback: ChannelCallback): Promise<void>;
}

interface ApprovalDelivery {
  approvalId: string;
  recipientId: string;          // internal user id
  recipientExternalId: string;  // Slack user id, email, etc.
  title: string;
  description: string;
  context: Record<string, unknown>;
  actions: Array<{
    label: string;
    value: string;
    style: 'primary' | 'danger' | 'default';
  }>;
  expiresAt: Date;
}
```

### 6.3 Slack Adapter Example

```typescript
// channels/slack-adapter.ts
import { WebClient } from '@slack/web-api';

class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack';
  readonly supportedActions = ['notify', 'approval', 'status', 'escalation'] as const;

  async sendApproval(request: ApprovalDelivery): Promise<DeliveryReceipt> {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🔔 ${request.title}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: request.description },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: Object.entries(request.context)
            .map(([k, v]) => `*${k}:* ${v}`)
            .join('\n'),
        },
      },
      {
        type: 'actions',
        block_id: `approval:${request.approvalId}`,
        elements: request.actions.map(action => ({
          type: 'button',
          text: { type: 'plain_text', text: action.label },
          value: action.value,
          style: action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'danger' : undefined,
          action_id: `approval_${action.value}`,
        })),
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `⏰ Expires: <!date^${Math.floor(request.expiresAt.getTime()/1000)}^{date_short_pretty} at {time}|${request.expiresAt.toISOString()}>` },
        ],
      },
    ];

    const result = await this.slack.chat.postMessage({
      channel: request.recipientExternalId,
      text: `Approval needed: ${request.title}`,
      blocks,
    });

    return {
      channel: 'slack',
      externalId: result.ts!,
      deliveredAt: new Date(),
      status: 'delivered',
    };
  }
}
```

---

## 7. Agent Execution Delegation

### 7.1 Architecture

FlowGrid does NOT run LLMs itself. It delegates to external providers:

```
┌─────────────────────────────────────────────────────────┐
│                 Agent Executor Service (:3008)            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Execution Context Builder             │   │
│  │  • Load agent definition (system prompt, tools)   │   │
│  │  • Load flow state (relevant variables)           │   │
│  │  • Load agent memory (conversation history)       │   │
│  │  • Load tool definitions                          │   │
│  │  • Apply tenant config (model, temperature)       │   │
│  └─────────────────────┬────────────────────────────┘   │
│                        │                                  │
│  ┌─────────────────────▼────────────────────────────┐   │
│  │               LLM Router                          │   │
│  │  • Model selection (per agent or tenant default)  │   │
│  │  • Fallback chain (Claude → GPT → Gemini)        │   │
│  │  • Rate limiting (per tenant, per model)          │   │
│  │  • Cost tracking                                  │   │
│  └──────────┬──────────┬──────────┬─────────────────┘   │
│             │          │          │                       │
│             ▼          ▼          ▼                       │
│       ┌──────────┐ ┌──────┐ ┌──────────┐               │
│       │ Anthropic│ │OpenAI│ │  Azure   │               │
│       │  Claude  │ │ GPT  │ │ OpenAI   │               │
│       └──────────┘ └──────┘ └──────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Tool Executor                        │   │
│  │  • Execute tool calls from LLM responses          │   │
│  │  • ReAct loop (call → tool → call → ...)         │   │
│  │  • Sandboxed execution                            │   │
│  │  • Timeout management                             │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Execution Flow

```typescript
// agent-executor/executor.ts
class AgentExecutor {
  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const { agentSlug, variables, tenantId, timeout } = request;

    // 1. Load agent definition
    const agent = await agentService.getAgent(agentSlug, tenantId);

    // 2. Build execution context
    const context = await this.buildContext(agent, variables, tenantId);

    // 3. Select LLM provider
    const llm = this.selectLLM(agent, tenantId);

    // 4. Execute with tool loop
    const result = await this.runAgentLoop(llm, context, timeout);

    // 5. Track costs
    await this.trackUsage(tenantId, agentSlug, result.usage);

    return result;
  }

  private async buildContext(
    agent: AgentDefinition,
    variables: Record<string, unknown>,
    tenantId: string,
  ): Promise<ExecutionContext> {
    // Load conversation history for this agent in this flow
    const memory = await agentStateStore.get(variables._instanceId, agent.slug);

    // Build system prompt with dynamic context
    const systemPrompt = this.renderSystemPrompt(agent, variables);

    // Resolve tool definitions
    const tools = await Promise.all(
      agent.tools.map(t => toolRegistry.getToolDefinition(t, tenantId))
    );

    return {
      systemPrompt,
      messages: memory?.messages || [],
      tools,
      variables,
      maxTokens: agent.maxTokens || 4096,
      temperature: agent.temperature ?? 0.1,
    };
  }

  private async runAgentLoop(
    llm: LLMClient,
    context: ExecutionContext,
    timeout: number,
  ): Promise<AgentExecutionResult> {
    const deadline = Date.now() + timeout;
    let messages = [
      { role: 'system', content: context.systemPrompt },
      ...context.messages,
    ];
    const toolResults: ToolCallResult[] = [];
    let totalUsage = { inputTokens: 0, outputTokens: 0 };

    while (Date.now() < deadline) {
      // Call LLM
      const response = await llm.chat({
        messages,
        tools: context.tools,
        maxTokens: context.maxTokens,
        temperature: context.temperature,
      });

      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;

      // Check for tool calls
      if (response.toolCalls?.length) {
        for (const toolCall of response.toolCalls) {
          const toolResult = await this.executeTool(toolCall, context);
          toolResults.push(toolResult);
          messages.push(
            { role: 'assistant', content: response.content, toolCalls: response.toolCalls },
            { role: 'tool', toolCallId: toolCall.id, content: JSON.stringify(toolResult.output) },
          );
        }
        continue; // Loop back for next LLM response
      }

      // No tool calls — agent is done
      return {
        output: response.content,
        toolResults,
        usage: totalUsage,
        messages,
      };
    }

    throw new TimeoutError(`Agent ${context.systemPrompt} exceeded timeout of ${timeout}ms`);
  }
}
```

### 7.3 Tool Execution

```typescript
// agent-executor/tool-executor.ts
class ToolExecutor {
  private registry = new Map<string, ToolImplementation>();

  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolCallResult> {
    const impl = this.registry.get(toolCall.name);
    if (!impl) {
      return { output: { error: `Unknown tool: ${toolCall.name}` }, success: false };
    }

    try {
      // Validate input
      const validated = impl.inputSchema.parse(toolCall.arguments);

      // Execute with timeout
      const output = await Promise.race([
        impl.execute(validated, context),
        timeout(impl.timeoutMs || 30_000),
      ]);

      return { output, success: true };
    } catch (error) {
      return { output: { error: error.message }, success: false };
    }
  }
}

// Built-in tool types:
// - API call tools (HTTP requests to external services)
// - Database query tools (read from tenant's connected systems)
// - Integration tools (ServiceNow, Jira, GitHub via integration-service)
// - State tools (read/write flow state)
// - Human tools (create approval request, wait for response)
```

---

## 8. Monitoring & Observability

### 8.1 Observability Stack

```
┌──────────────────────────────────────────────────────────┐
│                  Monitoring Service (:3009)                │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Flow Execution Dashboard                │ │
│  │                                                      │ │
│  │  Active Flows: 12    Completed Today: 47             │ │
│  │  Failed: 2           Avg Duration: 3m 24s            │ │
│  │                                                      │ │
│  │  ┌─ Incident Resolution ──────────────────────────┐ │ │
│  │  │  [classify] ✅ → [approve] ⏳ → [resolve] ⬜   │ │ │
│  │  │  Started: 2m ago  Status: Awaiting Approval     │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Agent Metrics   │  │ System Health               │  │
│  │                 │  │                              │  │
│  │ Classifier:     │  │ orchestrator: ✅ healthy     │  │
│  │  Avg: 2.1s      │  │ task-queue:   ✅ 3 pending   │  │
│  │  Success: 98.2% │  │ event-bus:    ✅ 12 msg/s    │  │
│  │  Cost: $0.03/op │  │ state-store:  ✅ 2ms p99     │  │
│  │                 │  │ channels:     ✅ all up       │  │
│  │ Resolver:       │  │                              │  │
│  │  Avg: 8.4s      │  │ Redis: 45% mem               │  │
│  │  Success: 94.1% │  │ PG: 12 active connections    │  │
│  │  Cost: $0.12/op │  │ Queue depth: 7               │  │
│  └─────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 8.2 Metrics Collection

```typescript
// monitoring/metrics.ts
interface FlowMetrics {
  flowsStarted: Counter;
  flowsCompleted: Counter;
  flowsFailed: Counter;
  flowDuration: Histogram;        // seconds
  activeFlows: Gauge;
}

interface AgentMetrics {
  agentInvocations: Counter;      // labels: agent_slug, tenant_id
  agentDuration: Histogram;       // labels: agent_slug
  agentErrors: Counter;           // labels: agent_slug, error_type
  agentTokensUsed: Counter;       // labels: agent_slug, model, direction(input/output)
  agentCost: Counter;             // labels: agent_slug, model, tenant_id
  toolCalls: Counter;             // labels: agent_slug, tool_name
}

interface ApprovalMetrics {
  approvalsCreated: Counter;
  approvalsCompleted: Counter;    // labels: result (approved/rejected)
  approvalResponseTime: Histogram;
  approvalSLABreaches: Counter;
  pendingApprovals: Gauge;
}
```

### 8.3 Structured Logging

Every service emits structured JSON logs with correlation IDs:

```typescript
// Every log entry includes:
{
  "timestamp": "2026-02-13T07:41:00.000Z",
  "level": "info",
  "service": "orchestrator",
  "correlationId": "uuid",       // traces across services
  "instanceId": "uuid",          // flow instance
  "tenantId": "uuid",
  "message": "Task dispatched to agent",
  "data": {
    "agentSlug": "classifier",
    "taskId": "task_001",
    "queueDepth": 3
  }
}
```

### 8.4 Flow Execution Trace

The event store enables full trace reconstruction:

```typescript
// monitoring/trace.ts
async function getFlowTrace(instanceId: string): Promise<FlowTrace> {
  const events = await db.query(`
    SELECT * FROM events
    WHERE instance_id = $1
    ORDER BY timestamp ASC
  `, [instanceId]);

  return {
    instanceId,
    timeline: events.map(e => ({
      timestamp: e.timestamp,
      type: e.type,
      data: e.data,
      duration: calculateStepDuration(e, events),
    })),
    totalDuration: events[events.length - 1].timestamp - events[0].timestamp,
    agentCalls: events.filter(e => e.type === 'agent.completed').length,
    approvals: events.filter(e => e.type.startsWith('approval.')).length,
    errors: events.filter(e => e.type.includes('failed') || e.type.includes('error')),
  };
}
```

---

## 9. New Services & Components (Full Service Map)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          nginx (reverse proxy)                       │
├────────┬────────┬────────┬────────┬────────┬────────┬───────┬──────┤
│        │        │        │        │        │        │       │      │
│ auth   │ agent  │design  │ integ  │export  │ORCH    │INTER  │CHAN  │
│ :3002  │ :3001  │ :3003  │ :3004  │ :3005  │:3006   │:3007  │:3008│
│        │        │        │        │        │        │       │      │
│existing│existing│existing│existing│from L2 │  NEW   │ NEW   │ NEW │
├────────┴────────┴────────┴────────┴────────┴────────┴───────┴──────┤
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐ │
│  │ AGENT EXECUTOR  │  │ MONITORING SVC   │  │  SCHEDULER SVC    │ │
│  │ :3009           │  │ :3010            │  │  :3011            │ │
│  │                 │  │                  │  │                    │ │
│  │ NEW             │  │ NEW              │  │  NEW               │ │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘ │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                        Data Layer                                    │
│                                                                      │
│  ┌───────────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │  PostgreSQL    │  │  Redis   │  │  S3/MinIO │  │  BullMQ      │ │
│  │               │  │          │  │           │  │  (Redis)     │ │
│  │ • Process defs│  │ • Cache  │  │ • Exports │  │ • Task queue │ │
│  │ • Instances   │  │ • Events │  │ • Logs    │  │ • DLQ        │ │
│  │ • State       │  │ • Pub/Sub│  │           │  │              │ │
│  │ • Events      │  │ • Sessions│ │           │  │              │ │
│  │ • Approvals   │  │          │  │           │  │              │ │
│  └───────────────┘  └──────────┘  └───────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Service Summary

| Service | Port | Status | Responsibility |
|---|---|---|---|
| auth-service | 3002 | Existing | Authentication, RBAC, multi-tenant |
| agent-service | 3001 | Existing | Agent CRUD, versioning |
| design-service | 3003 | Existing | AI-powered design analysis |
| integration-service | 3004 | Existing | ServiceNow/Jira/GitHub connectors |
| export-service | 3005 | From L2 | Code generation & export |
| **orchestrator-service** | **3006** | **NEW** | BPMN execution engine, process lifecycle |
| **interaction-service** | **3007** | **NEW** | Approval queue, SLA, escalation |
| **channel-gateway** | **3008** | **NEW** | Multi-channel delivery (Slack/Teams/Email) |
| **agent-executor** | **3009** | **NEW** | LLM API calls, tool execution, ReAct loop |
| **monitoring-service** | **3010** | **NEW** | Dashboards, metrics, traces |
| **scheduler-service** | **3011** | **NEW** | Cron-triggered flows, scheduled tasks |

---

## 10. Database Schema

### 10.1 Core Orchestration Tables

```sql
-- ============================================================
-- PROCESS DEFINITIONS (deployed BPMN processes)
-- ============================================================
CREATE TABLE process_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID NOT NULL,                     -- link to FlowGrid design
    design_version INTEGER NOT NULL,
    name VARCHAR(200) NOT NULL,
    bpmn_xml TEXT NOT NULL,
    parsed_model JSONB NOT NULL,                 -- pre-parsed for fast loading
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, suspended, retired
    deployed_by UUID REFERENCES users(id),
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL,

    UNIQUE(design_id, design_version, tenant_id)
);

-- ============================================================
-- PROCESS INSTANCES (running flows)
-- ============================================================
CREATE TABLE process_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_id UUID NOT NULL REFERENCES process_definitions(id),
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    -- running, suspended, completed, failed, cancelled
    started_by UUID,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    current_tasks JSONB DEFAULT '[]',            -- active task IDs
    variables JSONB DEFAULT '{}',                -- initial variables
    correlation_id UUID,                         -- for event correlation
    parent_instance_id UUID,                     -- for sub-processes
    tenant_id UUID NOT NULL
);

CREATE INDEX idx_instances_status ON process_instances(status, tenant_id);
CREATE INDEX idx_instances_definition ON process_instances(definition_id);
CREATE INDEX idx_instances_correlation ON process_instances(correlation_id);

-- ============================================================
-- TASK EXECUTIONS (individual task runs within an instance)
-- ============================================================
CREATE TABLE task_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES process_instances(id),
    task_id VARCHAR(200) NOT NULL,               -- BPMN task element ID
    task_name VARCHAR(200),
    task_type VARCHAR(50) NOT NULL,              -- service_task, user_task, etc.
    agent_slug VARCHAR(100),                     -- which agent handles it
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, dispatched, running, completed, failed, cancelled, waiting
    input_variables JSONB,
    output_variables JSONB,
    error_message TEXT,
    attempt_count INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    tenant_id UUID NOT NULL
);

CREATE INDEX idx_tasks_instance ON task_executions(instance_id);
CREATE INDEX idx_tasks_status ON task_executions(status, tenant_id);

-- ============================================================
-- APPROVAL REQUESTS
-- ============================================================
CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES process_instances(id),
    task_execution_id UUID REFERENCES task_executions(id),
    task_id VARCHAR(200) NOT NULL,

    -- Approval details
    type VARCHAR(30) NOT NULL,                   -- approve_reject, review_edit, inform, manual_task
    title VARCHAR(500) NOT NULL,
    description TEXT,
    context JSONB DEFAULT '{}',
    editable_fields JSONB DEFAULT '[]',

    -- Assignment
    assignment_rule JSONB NOT NULL,
    assigned_to UUID,
    approval_group VARCHAR(200),

    -- SLA
    sla JSONB NOT NULL,
    escalation JSONB NOT NULL DEFAULT '{"levels": []}',
    escalation_level INTEGER DEFAULT 0,

    -- Delivery
    channels JSONB DEFAULT '["web"]',
    priority VARCHAR(20) DEFAULT 'normal',
    delivery_receipts JSONB DEFAULT '[]',

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, assigned, in_progress, approved, rejected, escalated, expired, cancelled
    acknowledged_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    completed_by UUID,
    response JSONB,                              -- human's response payload
    state_updates JSONB,                         -- if human edited state

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL
);

CREATE INDEX idx_approvals_status ON approval_requests(status, tenant_id);
CREATE INDEX idx_approvals_assigned ON approval_requests(assigned_to, status);
CREATE INDEX idx_approvals_instance ON approval_requests(instance_id);

-- ============================================================
-- EVENTS (event sourcing / audit trail)
-- ============================================================
CREATE TABLE events (
    id UUID PRIMARY KEY,
    type VARCHAR(200) NOT NULL,
    source VARCHAR(100) NOT NULL,
    instance_id UUID,
    tenant_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL,
    correlation_id UUID,
    causation_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_type_ts ON events(type, timestamp);
CREATE INDEX idx_events_instance_ts ON events(instance_id, timestamp);
CREATE INDEX idx_events_tenant_ts ON events(tenant_id, timestamp);
CREATE INDEX idx_events_correlation ON events(correlation_id);

-- ============================================================
-- FLOW STATE (see section 3)
-- ============================================================
-- flow_states, flow_state_history, agent_states, global_states
-- (defined in section 3.2)

-- ============================================================
-- AGENT EXECUTION LOG (LLM call tracking)
-- ============================================================
CREATE TABLE agent_execution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_execution_id UUID REFERENCES task_executions(id),
    instance_id UUID NOT NULL,
    agent_slug VARCHAR(100) NOT NULL,

    -- LLM details
    model VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd DECIMAL(10, 6),
    duration_ms INTEGER,

    -- Tool calls
    tool_calls JSONB DEFAULT '[]',
    tool_call_count INTEGER DEFAULT 0,

    -- Result
    success BOOLEAN NOT NULL,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID NOT NULL
);

CREATE INDEX idx_agent_log_instance ON agent_execution_log(instance_id);
CREATE INDEX idx_agent_log_agent ON agent_execution_log(agent_slug, tenant_id);

-- ============================================================
-- SCHEDULED TRIGGERS
-- ============================================================
CREATE TABLE scheduled_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_id UUID NOT NULL REFERENCES process_definitions(id),
    cron_expression VARCHAR(100) NOT NULL,
    variables JSONB DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    next_trigger_at TIMESTAMPTZ,
    tenant_id UUID NOT NULL
);
```

### 10.2 Entity Relationship Diagram (ASCII)

```
process_definitions
       │
       │ 1:N
       ▼
process_instances ──────────── flow_states (1:1 current + N history)
       │                              │
       │ 1:N                          │
       ▼                              ▼
task_executions ─────── agent_execution_log (1:N)
       │
       │ 1:0..1
       ▼
approval_requests
       │
       │ N
       ▼
  delivery_receipts (in JSONB)

events ─── (references instance_id, standalone table)

agent_states ─── (per instance + agent combo)
global_states ─── (per tenant + namespace)
```

---

## 11. API Design

### 11.1 Flow Execution APIs

```
# Deploy a design as a runnable process
POST   /api/orchestrator/deploy
Body:  { designId, version }
Resp:  { definitionId, status: "deployed" }

# Start a flow instance
POST   /api/orchestrator/instances
Body:  { definitionId, variables, correlationId? }
Resp:  { instanceId, status: "running" }

# Get instance status
GET    /api/orchestrator/instances/{instanceId}
Resp:  { instanceId, status, currentTasks, startedAt, variables }

# Get instance execution trace
GET    /api/orchestrator/instances/{instanceId}/trace
Resp:  { timeline: [...events], duration, agentCalls, approvals }

# Cancel instance
POST   /api/orchestrator/instances/{instanceId}/cancel
Body:  { reason }
Resp:  { status: "cancelled" }

# List instances (with filters)
GET    /api/orchestrator/instances?status=running&definitionId=...&limit=50
Resp:  { instances: [...], total, hasMore }

# Signal an event to a waiting instance
POST   /api/orchestrator/instances/{instanceId}/signal
Body:  { taskId, payload }
Resp:  { status: "resumed" }
```

### 11.2 Approval APIs

```
# List pending approvals for current user
GET    /api/approvals?status=pending&assignedTo=me
Resp:  { approvals: [...], total }

# Get approval details
GET    /api/approvals/{approvalId}
Resp:  { ...ApprovalRequest, flowContext, agentOutput }

# Submit approval decision
POST   /api/approvals/{approvalId}/decide
Body:  { action: "approve"|"reject"|"edit", comment?, stateUpdates? }
Resp:  { status: "completed", flowResumed: true }

# Reassign approval
POST   /api/approvals/{approvalId}/reassign
Body:  { assignTo, reason }
Resp:  { status: "reassigned" }

# Bulk approve
POST   /api/approvals/bulk-decide
Body:  { approvalIds: [...], action: "approve", comment? }
Resp:  { results: [...] }
```

### 11.3 Monitoring APIs

```
# Dashboard summary
GET    /api/monitoring/dashboard
Resp:  { activeFlows, completedToday, failedToday, avgDuration, pendingApprovals }

# Agent performance
GET    /api/monitoring/agents/{agentSlug}/metrics?period=24h
Resp:  { invocations, avgDuration, successRate, avgCost, topErrors }

# Flow analytics
GET    /api/monitoring/flows/{definitionId}/analytics?period=7d
Resp:  { instances, avgDuration, completionRate, bottlenecks }

# System health
GET    /api/monitoring/health
Resp:  { services: { orchestrator: "healthy", ... }, queues, connections }

# Cost tracking
GET    /api/monitoring/costs?period=30d&groupBy=agent
Resp:  { total, byAgent: [...], byModel: [...], byTenant: [...] }
```

### 11.4 WebSocket (Real-time)

```
WS /api/ws/instances/{instanceId}
  → { type: "task.started", data: {...} }
  → { type: "task.completed", data: {...} }
  → { type: "approval.created", data: {...} }
  → { type: "flow.completed", data: {...} }

WS /api/ws/approvals
  → { type: "approval.assigned", data: {...} }
  → { type: "approval.escalated", data: {...} }

WS /api/ws/dashboard
  → { type: "metrics.update", data: {...} }
```

---

## 12. Implementation Roadmap

### Phase 1: Orchestrator Core (4-5 weeks)

| Task | Effort | Description |
|---|---|---|
| Orchestrator engine abstraction | 3d | Interface + bpmn-engine adapter |
| Process deployment | 3d | Parse BPMN, store, validate |
| Process execution | 5d | Start, run tasks, handle gateways |
| State store | 4d | PostgreSQL schema, CRUD, versioning, concurrency |
| Task dispatch (basic) | 3d | BullMQ setup, agent task handler |
| Event bus (basic) | 3d | Redis Streams, PostgreSQL persistence |
| Database migrations | 2d | All new tables |
| **Total** | **~23d** | |

### Phase 2: Agent Executor (3-4 weeks)

| Task | Effort | Description |
|---|---|---|
| LLM router | 3d | Multi-provider, fallback, rate limiting |
| Execution context builder | 3d | System prompt, tools, memory assembly |
| ReAct tool loop | 4d | Tool calling, result handling, timeout |
| Tool registry | 2d | Built-in tools + custom tool support |
| Cost tracking | 2d | Token counting, cost calculation |
| Agent state persistence | 2d | Conversation history per agent per flow |
| Integration with orchestrator | 2d | Signal back on completion |
| **Total** | **~18d** | |

### Phase 3: Interaction Service (3-4 weeks)

| Task | Effort | Description |
|---|---|---|
| Approval queue | 4d | Create, assign, complete, cancel |
| SLA tracker | 3d | Timeout monitoring, breach handling |
| Escalation engine | 3d | Multi-level, auto-actions |
| Channel gateway (framework) | 2d | Adapter interface, routing |
| Slack adapter | 3d | Blocks UI, button callbacks |
| Email adapter | 2d | HTML templates, reply handling |
| Web UI adapter (WebSocket) | 3d | Real-time notifications |
| **Total** | **~20d** | |

### Phase 4: Monitoring & Dashboard (2-3 weeks)

| Task | Effort | Description |
|---|---|---|
| Metrics collection | 3d | Prometheus-style counters, gauges |
| Flow execution dashboard | 4d | Visual timeline, status tracking |
| Agent performance views | 2d | Success rates, costs, durations |
| System health endpoint | 1d | Service status, queue depth |
| Flow trace viewer | 3d | Event-sourced execution replay |
| **Total** | **~13d** | |

### Phase 5: Frontend & Polish (3 weeks)

| Task | Effort | Description |
|---|---|---|
| "Deploy & Run" UI | 4d | Deploy design, start instances |
| Instance monitor view | 3d | Live flow visualization |
| Approval inbox | 3d | List, review, decide UI |
| Settings (channels, SLAs) | 2d | Configuration UI |
| E2E testing | 3d | Full flow execution tests |
| **Total** | **~15d** | |

### Total Estimate: ~18-22 weeks (1 developer), ~10-12 weeks (2 developers)

### Phase 6 (Future)

- Teams adapter (~2 weeks)
- Advanced scheduling (cron triggers, event triggers) (~2 weeks)
- Sub-process support (call activities) (~2 weeks)
- Multi-tenancy hardening (~2 weeks)
- Migration to Zeebe (if scale demands) (~4-6 weeks)

---

## 13. Architecture Diagrams

### 13.1 Full System Architecture (Level 3)

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│                         FlowGrid Platform (Level 3)                    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                          Frontend                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │ │
│  │  │ Design   │ │ Deploy & │ │ Approval │ │ Monitor Dashboard │  │ │
│  │  │ Studio   │ │ Run      │ │ Inbox    │ │                   │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘  │ │
│  └──────────────────────────────┬───────────────────────────────────┘ │
│                                 │ REST + WebSocket                     │
│  ┌──────────────────────────────▼───────────────────────────────────┐ │
│  │                        nginx + API Gateway                       │ │
│  └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──┘   │
│     │      │      │      │      │      │      │      │      │       │
│     ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼       │
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐ │
│  │auth ││agent││desig││integ││exprt││ORCH ││INTER││CHAN ││AGEX │ │
│  │:3002││:3001││:3003││:3004││:3005││:3006││:3007││:3008││:3009│ │
│  └──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘ │
│     │      │      │      │      │      │      │      │      │      │
│     │      │      │      │      │      │      │      │      │      │
│  ┌──▼──────▼──────▼──────▼──────▼──────▼──────▼──────▼──────▼──┐   │
│  │                     Internal Event Bus                       │   │
│  │                    (Redis Streams)                            │   │
│  └──┬──────────────────────────────────────────────────────┬──┘   │
│     │                                                       │       │
│  ┌──▼──────────────────────┐  ┌────────────────────────────▼──┐   │
│  │      Task Queue         │  │       Monitoring Service      │   │
│  │      (BullMQ/Redis)     │  │       :3010                   │   │
│  │                         │  │                                │   │
│  │  ┌────┐ ┌────┐ ┌────┐  │  │  Metrics │ Traces │ Dashboards│   │
│  │  │Prio│ │Std │ │Low │  │  └────────────────────────────────┘   │
│  │  └────┘ └────┘ └────┘  │                                       │
│  └─────────────────────────┘                                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                        Data Layer                             │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │  │
│  │  │ PostgreSQL  │  │  Redis   │  │ S3/MinIO │  │ (future) │ │  │
│  │  │             │  │          │  │          │  │ Elastic  │ │  │
│  │  │ Processes   │  │ Cache    │  │ Exports  │  │ Search   │ │  │
│  │  │ Instances   │  │ Events   │  │ Logs     │  │          │ │  │
│  │  │ State       │  │ Queues   │  │          │  │          │ │  │
│  │  │ Approvals   │  │ Sessions │  │          │  │          │ │  │
│  │  │ Events      │  │          │  │          │  │          │ │  │
│  │  │ Agent Logs  │  │          │  │          │  │          │ │  │
│  │  └─────────────┘  └──────────┘  └──────────┘  └──────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  Anthropic   │ │   OpenAI     │ │  External    │
     │  Claude API  │ │   GPT API   │ │  APIs        │
     └──────────────┘ └──────────────┘ │ (ServiceNow, │
                                        │  Jira, etc.) │
                                        └──────────────┘
```

### 13.2 Request Flow: Execute a Flow with HITL

```
User clicks "Run Flow"
        │
        ▼
┌─ orchestrator-service ──────────────────────────────────────────────┐
│  1. Start process instance                                          │
│  2. BPMN engine advances to first Service Task                      │
│  3. Dispatch agent task to queue                                    │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─ task-queue ────────────────────────────────────────────────────────┐
│  4. Worker picks up task                                            │
│  5. Calls agent-executor                                            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─ agent-executor ────────────────────────────────────────────────────┐
│  6. Build context (prompt + tools + state)                          │
│  7. Call LLM API (Claude)                                           │
│  8. Handle tool calls (ReAct loop)                                  │
│  9. Return result                                                   │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─ orchestrator-service ──────────────────────────────────────────────┐
│  10. Receive agent result, update state                             │
│  11. BPMN engine advances to User Task (HITL)                       │
│  12. Process SUSPENDS — waiting for human                           │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─ interaction-service ───────────────────────────────────────────────┐
│  13. Create approval request                                        │
│  14. Assign to user/group                                           │
│  15. Dispatch via channel-gateway                                   │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  Slack   │   │  Web UI  │   │  Email   │
    │  message │   │  notif   │   │  sent    │
    └────┬─────┘   └────┬─────┘   └──────────┘
         │              │
         ▼              ▼
    Human clicks    Human clicks
    "Approve" in    "Approve" in
    Slack           Web UI
         │              │
         └──────┬───────┘
                │
                ▼
┌─ interaction-service ───────────────────────────────────────────────┐
│  16. Record decision                                                │
│  17. Signal orchestrator to resume                                  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─ orchestrator-service ──────────────────────────────────────────────┐
│  18. Resume process instance                                        │
│  19. BPMN engine advances to next task                              │
│  20. ... (dispatch next agent, or reach End Event)                  │
│  21. Flow COMPLETED                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.3 Data Flow Diagram

```
                    ┌─────────────────┐
                    │   User/Client   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   API Gateway   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼─┐  ┌────────▼───┐  ┌──────▼──────┐
    │Orchestrate│  │ Approvals  │  │  Monitor    │
    │           │  │            │  │             │
    │ Start     │  │ List mine  │  │ Dashboard   │
    │ Cancel    │  │ Decide     │  │ Traces      │
    │ Signal    │  │ Reassign   │  │ Costs       │
    └─────┬─────┘  └─────┬──────┘  └──────┬──────┘
          │               │                │
          ▼               ▼                ▼
    ┌───────────────────────────────────────────┐
    │              PostgreSQL                    │
    │                                            │
    │  definitions │ instances │ states │ events │
    │  tasks │ approvals │ agent_logs             │
    └───────────────────────────────────────────┘
```

---

## Appendix A: IT4IT Alignment

This Level 3 architecture maps to the IT4IT Reference Architecture:

| IT4IT Value Stream | FlowGrid Component |
|---|---|
| Strategy to Portfolio (S2P) | Design Studio — agent capability planning |
| Requirement to Deploy (R2D) | Export Service — generate deployable code |
| Request to Fulfill (R2F) | Orchestrator + Interaction Service — execute flows, fulfill requests |
| Detect to Correct (D2C) | Monitoring + Event Bus — detect failures, auto-correct |

The orchestrator-service functions as the **Service Orchestration** backbone, while the interaction-service mirrors **Service Catalog** approval workflows.

---

## Appendix B: Security Considerations

1. **Tenant isolation**: All queries include `tenant_id`. Row-level security (RLS) in PostgreSQL.
2. **Agent execution sandboxing**: Tool execution in isolated contexts. No filesystem access.
3. **LLM API key management**: Per-tenant encrypted key storage. Never in state or logs.
4. **Approval auth**: RBAC enforced — only assigned users can approve.
5. **Event bus ACL**: Tenants can only subscribe to their own events.
6. **Rate limiting**: Per-tenant LLM call limits to prevent cost explosion.
7. **Audit trail**: Every action logged via event bus. Immutable event store.

---

## Appendix C: Scaling Strategy

**Stage 1 (MVP, current):** Single-instance services, PostgreSQL, Redis
- Handles: ~100 concurrent flows, ~1000 agent calls/day

**Stage 2 (Growth):** Horizontal service scaling, connection pooling
- Multiple orchestrator instances (stateless, bpmn-engine per request)
- BullMQ workers scale independently
- Read replicas for monitoring queries

**Stage 3 (Enterprise):** Consider Zeebe migration for orchestration
- Zeebe cluster for >10,000 concurrent flows
- Dedicated agent-executor pools per tenant
- Elasticsearch for event search at scale
