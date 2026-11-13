const WORK_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
]);

/**
 * Counts what the agent has produced in a turn (text, thoughts, tool calls,
 * plans), so a caller can tell whether it did anything since it last looked.
 */
export class TurnActivity {
  private produced = 0;

  note(sessionUpdate: string): void {
    if (WORK_UPDATES.has(sessionUpdate)) {
      this.produced += 1;
    }
  }

  get count(): number {
    return this.produced;
  }
}
