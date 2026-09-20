export type ReasoningLevel = 'Low' | 'Medium' | 'High';
export type ProviderScope = 'local' | 'cloud';

export type ModelTier = 'local' | 'free-cloud' | 'api-cloud';
export interface ModelInfo {
  name: string;
  scope: ProviderScope;
  size?: number;
  modified_at?: string;
  details?: Record<string, unknown>;
  default?: boolean;
  tier?: ModelTier;
}

export interface CommitInfo {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  refs?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  status: 'running' | 'complete' | 'error' | 'cancelled';
  durationMs?: number;
  commits?: CommitInfo[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** attachment metadata (user messages) — bytes stay out, only names go here */
  atts?: { name: string; size: number; kind: string }[];
  toolCalls?: ToolCall[];
  toolLabel?: string;
  createdAt: number;
  durationSec?: number;
  tokens?: number;
}

export interface RepositoryContext {
  path: string;
  name: string;
  branch: string;
  dirty: boolean;
  diffStat: string;
  status?: string;
}

export interface AgentContextMemory {
  lastRepository?: string;
  lastBranch?: string;
  lastCommits?: CommitInfo[];
  lastFiles?: string[];
  lastDiff?: string;
  lastToolResult?: string;
  lastModel?: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: 'image' | 'text' | 'file';
  /** truncated plain-text content (text kind only) */
  text?: string;
  /** resized JPEG data URL (image kind only) */
  image?: string;
}

export interface Session {
  id: string;
  title: string;
  repository: string;
  branch: string;
  worktree: string;
  provider: ProviderScope;
  model: string;
  reasoningLevel: ReasoningLevel;
  messages: Message[];
  toolCalls: ToolCall[];
  contextMemory: AgentContextMemory;
  createdAt: number;
  updatedAt: number;
}

export interface BgRun {
  id: string;
  label: string;
  model: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  createdAt: number;
}
