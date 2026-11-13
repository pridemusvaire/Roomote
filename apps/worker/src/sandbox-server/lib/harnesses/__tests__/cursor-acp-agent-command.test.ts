import { DEFAULT_AGENT_COMMAND } from '../cursor-acp/agent-process';

// A regression guard, not a behavior test, backed by static reading of the
// cursor-agent 2026.11.11 bundle (no authenticated run was possible). The
// agent reads MCP servers from `<workspace>/.cursor/mcp.json` and
// `~/.cursor/mcp.json`, but loads one only once it is approved in
// `<HOME>/.cursor/projects/<hash>/mcp-approvals.json`, which a repository
// cannot write. Approval is waived by `ignoreApprovals`, which the CLI sets
// from `--approve-mcps` (and `--force` / `--yolo`) in its print path; the ACP
// chunks never set it, and ACP has no flow for approving a server
// (`session/request_permission` covers shell, edits, reads, web fetch and
// questions). So a repository's own MCP servers stay unstarted as long as the
// agent is launched with none of those flags.
//
// Not covered: project `.cursor/hooks.json` and `.claude/settings.json` hooks
// are loaded by the same agent (loadProjectHooks defaults to true and nothing
// disables it), and `--disable-project-configs` only skips `.cursor/cli.json`.
describe('the cursor-agent launch command', () => {
  it('never waives MCP server approval, so a repository cannot start its own servers', () => {
    expect(DEFAULT_AGENT_COMMAND).toEqual({
      command: 'cursor-agent',
      args: ['acp'],
    });
  });
});
