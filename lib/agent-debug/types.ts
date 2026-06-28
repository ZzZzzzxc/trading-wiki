export type AgentStepType =
  | 'planning' | 'tool_call' | 'llm_call' | 'rag_retrieve'
  | 'debate' | 'synthesize' | 'final_answer';

export type AgentErrorType =
  | 'intent_parse_failed' | 'rag_no_results' | 'llm_json_parse_failed'
  | 'tool_call_failed' | 'timeout' | 'rate_limited' | 'provider_unavailable'
  | 'debate_failed' | 'unknown';

export interface AgentError {
  type: AgentErrorType;
  message: string;
  details?: unknown;
}

export interface AgentStep {
  stepId: string;
  runId: string;
  type: AgentStepType;
  name: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  input?: unknown;
  output?: unknown;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  tokens?: { input: number; output: number };
  prompt?: { system: string; user: string };
  response?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResult?: unknown;
  ragRetrieve?: {
    query: string;
    expandedQueries?: string[];
    resultsCount: number;
    topK: number;
  };
  error?: AgentError;
}

export interface AgentRun {
  runId: string;
  userQuery: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  config: { depth: string; focus: string; debate: boolean };
  model: string;
  totalTokens?: { input: number; output: number };
  steps: AgentStep[];
  finalAnswer?: string;
  error?: AgentError;
}

export interface AgentDebugEvent {
  type: string;
  runId: string;
  stepId?: string;
  [key: string]: unknown;
}

export interface AgentFeedback {
  runId: string;
  rating: 'good' | 'partial' | 'bad';
  labels: string[];
  comment?: string;
  createdAt: string;
}
