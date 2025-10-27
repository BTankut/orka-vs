import * as vscode from 'vscode';

/**
 * Supported CLI agents
 */
export type AgentType = 'claude' | 'codex' | 'gemini';

/**
 * Tool call from master CLI
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  success: boolean;
  agent?: AgentType;
  task_id?: string;
  output?: string;
  files_modified?: string[];
  execution_time?: number;
  error?: string;
}

/**
 * Slave task tracking
 */
export interface SlaveTask {
  id: string;
  agent: AgentType;
  instruction: string;
  context?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
  error?: string;
  startTime: number;
  endTime?: number;
}

/**
 * Master CLI execution options
 */
export interface MasterExecutionOptions {
  projectPath: string;
  sessionId?: string;
  command: string;
  onOutput: (data: string) => void;
  onToolCall: (tool: ToolCall) => Promise<ToolResult>;
  onProgress: (status: string) => void;
  onSession?: (sessionId: string) => void;
  token?: vscode.CancellationToken;
}

/**
 * Slave execution options
 */
export interface SlaveExecutionOptions {
  agent: AgentType;
  instruction: string;
  context?: string;
  projectPath: string;
}

/**
 * Telegram message
 */
export interface TelegramMessage {
  type: 'telegram-message' | 'telegram-response';
  content: string;
  sessionId?: string;
  projectPath?: string;
  chatId?: number;
}

/**
 * WebSocket message types
 */
export interface WebSocketMessage {
  type: 'chunk' | 'progress' | 'complete' | 'error';
  session_id?: string;
  data?: string;
  status?: string;
  error?: string;
}
