import { GIT_CREDENTIAL_NAME } from '../../lib/git-credential-name.js';

/** What a refused call tells the agent: which variable, and what to do instead. */
export function refusal(
  toolName: string,
  names: readonly string[],
  mayReference: boolean,
): string {
  const held = `${toolName} was not called: its input holds the value of ${names.join(', ')}. Secret values are never stored or sent on.`;

  if (!mayReference) {
    return `${held} This tool does not expand variable references, so remove the value from the input and call it again (an integration call uses the integration's stored credentials, so it never needs the secret as an argument).`;
  }

  // A repository credential has no variable to refer to: its value goes.
  const variables = names.filter((name) => name !== GIT_CREDENTIAL_NAME);

  if (variables.length === 0) {
    return `${held} A repository credential has no variable name, so remove the value from the input and call it again.`;
  }

  const refer = `Refer to the variable by its name (for example $${variables[0]})`;

  return variables.length === names.length
    ? `${held} ${refer} and call it again.`
    : `${held} ${refer}, remove the repository credential (it has no variable name), and call it again.`;
}
