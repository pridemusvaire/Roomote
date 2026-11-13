import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  type SetupModelProviderStatus,
  type SetupModelStatus,
} from '@roomote/types';

export function splitInferenceProviders(
  providerSetup: SetupModelStatus | null,
): {
  connectedProviders: SetupModelProviderStatus[];
  availableProviders: SetupModelProviderStatus[];
} {
  const providers = providerSetup?.providers ?? [];
  const connectedProviders = providers.filter(
    (provider) =>
      provider.runtimeApiKeySatisfied || provider.savedApiKeySatisfied,
  );
  // A provider that needs another one is offered only once a provider that
  // can serve every role is connected.
  const hasSelfSufficientProvider = connectedProviders.some(
    (provider) => !provider.hidden && !provider.requiresOtherProvider,
  );

  return {
    connectedProviders,
    // Only the OpenAI-compatible catalog template stays addable while
    // connected, so operators can create another named instance. Named
    // connected rows themselves stay out of the Add Provider list.
    availableProviders: providers.filter((provider) => {
      if (provider.hidden) {
        return false;
      }

      if (provider.requiresOtherProvider && !hasSelfSufficientProvider) {
        return false;
      }

      const isConnected =
        provider.runtimeApiKeySatisfied || provider.savedApiKeySatisfied;

      if (!isConnected) {
        return true;
      }

      return (
        provider.allowMultipleConnections === true &&
        provider.id === OPENAI_COMPATIBLE_PROVIDER_ID
      );
    }),
  };
}
