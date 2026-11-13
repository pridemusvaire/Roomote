import { redactToolData } from '@roomote/communication/redact-secrets';

import { MaskingEventEmitter } from './masking-emitter';

type Emitter = MaskingEventEmitter;

/**
 * The runtime emitter for a Cursor task. OpenCode keeps secret values out of
 * its output with a tool-safety plugin; `cursor-agent` has no plugin hook,
 * and the pattern redaction every tool event already goes through cannot
 * recognise an arbitrary token. So the exact values of the task's secret
 * variables are masked out of everything the agent produces (see
 * `MaskingEventEmitter`), and out of tool data by the shared redactor.
 */
export class RedactingEventEmitter extends MaskingEventEmitter {
  override toolCall(options: Parameters<Emitter['toolCall']>[0]): void {
    super.toolCall(this.tool(options));
  }

  override toolUpdate(options: Parameters<Emitter['toolUpdate']>[0]): void {
    super.toolUpdate(this.tool(options));
  }

  override toolResult(options: Parameters<Emitter['toolResult']>[0]): void {
    super.toolResult(this.tool(options));
  }

  private tool<T>(options: T): T {
    return this.secrets.length > 0
      ? redactToolData(options, this.secrets)
      : options;
  }
}
