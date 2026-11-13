import { toolSecretPolicy } from '../tool-secret-policy';

describe('toolSecretPolicy', () => {
  it('masks the tools that write text people read', () => {
    for (const name of [
      'send_chat_reply',
      'send_chat_message',
      'report_to_parent_session',
      'manage_source_control',
      'manage_tasks',
      'report_platform_issue',
    ]) {
      expect(toolSecretPolicy(name)).toBe('mask');
    }
  });

  it('rejects, with a variable to refer to, the tools that store text read or run later', () => {
    for (const name of [
      'manage_environments',
      'create_custom_skill',
      'update_custom_skill',
      'manage_custom_automations',
      'save_task_memory',
      'update_personalization',
      'submit_automation_work_items',
    ]) {
      expect(toolSecretPolicy(name)).toBe('reject-reference');
    }
  });

  it('rejects, without a variable to refer to, the tools that expand none', () => {
    for (const name of [
      'fetch_url',
      'call_integration_tool',
      'find_integration_tools',
      'manage_artifacts',
      'request_environment_variables',
      'get_about_me',
      'list_repositories',
    ]) {
      expect(toolSecretPolicy(name)).toBe('reject');
    }
  });

  it('rejects a tool nobody has decided on, including prototype names', () => {
    expect(toolSecretPolicy('some_new_tool')).toBe('reject');
    expect(toolSecretPolicy('constructor')).toBe('reject');
    expect(toolSecretPolicy('toString')).toBe('reject');
  });

  it('has decided on every tool the server registers', async () => {
    vi.resetModules();
    vi.stubEnv('ROOMOTE_TASK_ID', 'task-1');
    vi.stubEnv('ROOMOTE_BRAIN_AVAILABLE', 'true');
    vi.stubEnv('ROOMOTE_SLACK_CHANNEL', 'C1');
    vi.stubEnv('ROOMOTE_ON_DEMAND_REPOSITORIES', 'true');
    vi.stubEnv('ROOMOTE_ON_DEMAND_MCP_CATALOG_PATH', '/tmp/catalog.json');
    const registered = new Set<string>();

    // Each combination switches on a different set of conditional tools.
    for (const [child, taskType] of [
      ['false', 'scan'],
      ['false', 'standard'],
      ['true', 'standard'],
    ]) {
      vi.resetModules();
      vi.stubEnv('ROOMOTE_FAST_AGENT_CHILD', child);
      vi.stubEnv('ROOMOTE_TASK_TYPE', taskType);
      const { roomoteMcpServer } = await import('../index.js');
      Object.keys(
        (roomoteMcpServer as unknown as { _registeredTools: object })
          ._registeredTools,
      ).forEach((name) => registered.add(name));
    }
    vi.unstubAllEnvs();

    const { CLASSIFIED_TOOL_NAMES } = await import('../tool-secret-policy');
    expect(registered).toContain('request_environment_variables');
    expect(registered).toContain('submit_automation_work_items');
    expect(registered).toContain('call_integration_tool');
    expect(
      [...registered].filter((n) => !CLASSIFIED_TOOL_NAMES.includes(n)),
    ).toEqual([]);
  });
});
