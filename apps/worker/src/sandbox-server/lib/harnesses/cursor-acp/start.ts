import type { ResultPromise } from 'execa';

import { sensitiveEnvValues } from '@roomote/communication/redact-secrets';

import { createPrefixedLogger, describeUnknownError } from '../logging';

import { AcpConnection } from './acp-connection';
import { buildCursorAgentEnv } from './agent-env';
import { killAgentTree } from './agent-process-tree';
import { closeOnAgentExit } from './close-on-agent-exit';
import {
  connectBeforeExit,
  DEFAULT_AGENT_COMMAND,
  requireCursorApiKey,
  spawnCursorAgent,
} from './agent-process';
import { createCloseoutCheck } from './closeout-check';
import { CursorAcpHarness } from './harness';
import { toFallbackConfig } from './fallback-config';
import { readHarnessTuning } from './harness-tuning';
import { toAcpMcpServers } from './mcp-servers';
import { SecretSet } from './secret-mask';
import type { StartCursorAcpHarnessOptions } from './start-options';

interface StartCursorAcpHarnessResult {
  harness: CursorAcpHarness;
  subprocess: ResultPromise;
}

export async function startCursorAcpHarness(
  options: StartCursorAcpHarnessOptions,
): Promise<StartCursorAcpHarnessResult> {
  const { workspacePath, runtimeEnv, logger } = options;
  const log = createPrefixedLogger(logger, '[cursor-acp]');
  const agent = options.agentCommand ?? DEFAULT_AGENT_COMMAND;

  const secrets = new SecretSet(
    options.secretValues ?? sensitiveEnvValues(runtimeEnv),
  );

  requireCursorApiKey(runtimeEnv);

  log.info(
    `Launching ${agent.command} cwd=${workspacePath} model=${options.modelOverride ?? 'agent-default'}`,
  );
  const subprocess = spawnCursorAgent({
    ...agent,
    cwd: workspacePath,
    env: buildCursorAgentEnv(runtimeEnv),
    cancelSignal: options.cancelSignal,
    logger,
    secrets,
  });

  try {
    if (!subprocess.stdin || !subprocess.stdout) {
      throw new Error('cursor-agent subprocess is missing stdio streams.');
    }

    const connection = new AcpConnection(subprocess.stdin, subprocess.stdout);
    closeOnAgentExit(subprocess, connection);

    const harness = new CursorAcpHarness({
      connection,
      workspacePath,
      logger,
      mcpServers: toAcpMcpServers(options.mcpServers, (name) =>
        log.info(`Skipping unsupported MCP config name=${name}`),
      ),
      initialSessionId: options.initialSessionId,
      requestedModel: options.modelOverride,
      fallback: toFallbackConfig(options),
      closeoutCheck: createCloseoutCheck(runtimeEnv, log),
      beforeQueuedPrompt: options.beforeQueuedPrompt,
      developerInstructionsContent: options.developerInstructionsContent,
      restoreContext: options.restoreContext,
      secrets,
      onDispose: () => killAgentTree(subprocess),
      ...readHarnessTuning(runtimeEnv),
    });

    await connectBeforeExit(harness, subprocess);

    log.info(`Connected sessionId=${options.initialSessionId ?? 'none'}`);

    return { harness, subprocess };
  } catch (error) {
    log.error(`Failed to start cursor-agent: ${describeUnknownError(error)}`);
    killAgentTree(subprocess);
    throw error;
  }
}
