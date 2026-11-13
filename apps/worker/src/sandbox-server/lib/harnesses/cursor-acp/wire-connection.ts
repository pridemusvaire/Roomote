import type { AcpConnection } from './acp-connection';
import type { AcpSessionUpdate } from './acp-types';
import { selectPermissionOutcome } from './permission';
import type { UpdateTranslator } from './update-translator';

/** Routes what the agent sends us: streamed updates, permissions, exit. */
export function wireConnection(
  connection: AcpConnection,
  translator: UpdateTranslator,
  onClose: () => void,
): void {
  connection.onNotification('session/update', (params) => {
    const { sessionId, update } = params as {
      sessionId?: string;
      update: AcpSessionUpdate;
    };
    translator.handle(update, sessionId);
  });
  connection.onRequest('session/request_permission', async (params) =>
    selectPermissionOutcome(params),
  );
  connection.onClose(onClose);
}
