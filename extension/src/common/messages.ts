/**
 * Typed IPC Message Protocol for Chrome MV3 Extension
 */

import {
  PagePerception,
  SanitizedContext,
  AgentAction,
  PrivacyReceipt,
  PrivacyDecision,
} from './types.js';

export type MessageType =
  | 'PING'
  | 'PONG'
  | 'GET_PAGE_METADATA'
  | 'PAGE_METADATA_RESPONSE'
  | 'RUN_PERCEPTION'
  | 'PERCEPTION_RESPONSE'
  | 'SUBMIT_TASK'
  | 'TASK_STATUS_UPDATE'
  | 'PRIVACY_RECEIPT_UPDATE'
  | 'EXECUTE_ACTION'
  | 'ACTION_EXECUTION_RESULT';

export interface BaseMessage {
  type: MessageType;
  id: string;
  timestamp: number;
}

export interface PingMessage extends BaseMessage {
  type: 'PING';
}

export interface PongMessage extends BaseMessage {
  type: 'PONG';
  status: 'healthy' | 'error';
  details?: Record<string, unknown>;
}

export interface GetPageMetadataMessage extends BaseMessage {
  type: 'GET_PAGE_METADATA';
}

export interface PageMetadataResponse extends BaseMessage {
  type: 'PAGE_METADATA_RESPONSE';
  url: string;
  title: string;
  viewport: { width: number; height: number };
  interactiveCount: number;
}

export interface RunPerceptionMessage extends BaseMessage {
  type: 'RUN_PERCEPTION';
  includeScreenshot?: boolean;
}

export interface PerceptionResponseMessage extends BaseMessage {
  type: 'PERCEPTION_RESPONSE';
  perception: PagePerception;
}

export interface SubmitTaskMessage extends BaseMessage {
  type: 'SUBMIT_TASK';
  task: string;
}

export interface TaskStatusUpdateMessage extends BaseMessage {
  type: 'TASK_STATUS_UPDATE';
  status: 'idle' | 'analyzing' | 'reasoning' | 'awaiting_confirmation' | 'executing' | 'completed' | 'failed';
  stepDescription: string;
  receipt?: PrivacyReceipt;
  pendingAction?: AgentAction;
  error?: string;
}

export interface ExecuteActionMessage extends BaseMessage {
  type: 'EXECUTE_ACTION';
  action: AgentAction;
  confirmed?: boolean;
}

export interface ActionExecutionResult extends BaseMessage {
  type: 'ACTION_EXECUTION_RESULT';
  success: boolean;
  action: AgentAction;
  error?: string;
}

export type ExtensionMessage =
  | PingMessage
  | PongMessage
  | GetPageMetadataMessage
  | PageMetadataResponse
  | RunPerceptionMessage
  | PerceptionResponseMessage
  | SubmitTaskMessage
  | TaskStatusUpdateMessage
  | ExecuteActionMessage
  | ActionExecutionResult;
