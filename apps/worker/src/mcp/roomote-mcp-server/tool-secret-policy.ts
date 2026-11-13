/**
 * What the Roomote MCP server does when a tool's input holds the value of one
 * of the task's secret variables (Cursor tasks only; see `MaskingMcpServer`).
 *
 * - `mask`: the text goes OUT to people or another system, so the value is
 *   replaced with `[redacted]` and the call goes ahead.
 * - `reject-reference`: the input is stored as text that is read or run
 *   later (an environment's scripts, a skill, a memory), so replacing the
 *   value would silently change what is saved. The call fails instead, naming
 *   the variable, and the agent repeats it with `$NAME` where the value was.
 * - `reject`: the input is not stored as text that expands variables (a URL, an
 *   integration call's arguments, an upload, a read), so `$NAME` would be sent
 *   literally. The call fails and the agent repeats it without the value.
 *
 * Both rejections apply to values that look like real secrets only; a
 * development default such as `postgres` is not refused (see
 * `looksLikeRealSecret`). A tool missing from the map is `reject`: a new tool
 * is refused a secret until someone decides what it does with its input.
 */
type ToolSecretPolicy = 'mask' | 'reject-reference' | 'reject';

const POLICIES: Readonly<Record<string, ToolSecretPolicy>> = {
  // Text that people read (or that is posted somewhere they can).
  send_chat_reply: 'mask',
  send_chat_message: 'mask',
  send_chat_reaction_emoji: 'mask',
  report_to_parent_session: 'mask',
  report_platform_issue: 'mask',
  report_vulnerability_assessment: 'mask',
  show_widget: 'mask',
  // Pull request and merge request comments, and a message to another task.
  manage_source_control: 'mask',
  manage_tasks: 'mask',

  // Stored as text that is read or run later: environments, skills,
  // automations, memory, personalization, work items that start tasks. A
  // `$NAME` left in place of the value is what the agent should save.
  manage_environments: 'reject-reference',
  manage_custom_automations: 'reject-reference',
  create_custom_skill: 'reject-reference',
  update_custom_skill: 'reject-reference',
  save_task_memory: 'reject-reference',
  update_personalization: 'reject-reference',
  submit_automation_work_items: 'reject-reference',

  // A request whose target the model chose (a masked URL would be a different
  // request than the one asked for), the arguments of an integration call,
  // uploads, and variable names: no `$NAME` is expanded in any of them.
  fetch_url: 'reject',
  manage_artifacts: 'reject',
  request_environment_variables: 'reject',
  call_integration_tool: 'reject',
  find_integration_tools: 'reject',

  // Reads. Nothing is sent or stored, and a secret value in their input is a
  // mistake, so they get the same refusal as an unknown tool.
  get_about_me: 'reject',
  describe_video: 'reject',
  open_artifact: 'reject',
  list_repositories: 'reject',
  clone_repository: 'reject',
  list_chat_destinations: 'reject',
  get_chat_channel_messages: 'reject',
  get_chat_message_context: 'reject',
};

export function toolSecretPolicy(toolName: string): ToolSecretPolicy {
  return Object.hasOwn(POLICIES, toolName) ? POLICIES[toolName]! : 'reject';
}

/** Test-only: every tool the map decides on. */
export const CLASSIFIED_TOOL_NAMES = Object.keys(POLICIES);
