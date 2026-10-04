/**
 * The assistant's model, provider-neutral (ADR-0012): messages in, text and tool calls out, with token usage. The
 * shape follows the tool-use convention (assistant `tool_use` blocks answered by user `tool_result` blocks) so a vendor
 * adapter is thin. Only the deterministic fake exists until ADR-0012 is accepted (D-218).
 */
export const ASSISTANT_MODEL = Symbol('ASSISTANT_MODEL');

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input (object, `additionalProperties: false`). */
  inputSchema: Record<string, unknown>;
}

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type AssistantMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: AssistantBlock[] }
  | { role: 'tool_results'; results: { toolUseId: string; content: string; isError: boolean }[] };

export interface ModelReply {
  content: AssistantBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  usage: { inputTokens: number; outputTokens: number };
}

export interface AssistantModel {
  readonly provider: string;
  readonly model: string;
  complete(request: {
    system: string;
    messages: AssistantMessage[];
    tools: ToolSpec[];
    maxTokens: number;
  }): Promise<ModelReply>;
}

export class AssistantModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantModelError';
  }
}
