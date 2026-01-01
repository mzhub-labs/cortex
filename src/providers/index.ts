import { BaseProvider } from "./BaseProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { GeminiProvider } from "./GeminiProvider";
import { GroqProvider } from "./GroqProvider";
import { CerebrasProvider } from "./CerebrasProvider";
import type { ProviderConfig, ProviderName } from "../types";

export {
  BaseProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  GroqProvider,
  CerebrasProvider,
};

/**
 * Provider registry for creating providers by name
 */
const providerRegistry: Record<
  ProviderName,
  new (config: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }) => BaseProvider
> = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  groq: GroqProvider,
  cerebras: CerebrasProvider,
};

/**
 * Create a provider instance from configuration
 */
export function createProvider(config: ProviderConfig): BaseProvider {
  const ProviderClass = providerRegistry[config.provider];
  if (!ProviderClass) {
    throw new Error(
      `Unknown provider: ${config.provider}. Available: ${Object.keys(
        providerRegistry
      ).join(", ")}`
    );
  }

  return new ProviderClass({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });
}

/**
 * Check which providers are available (have their SDKs installed)
 */
export function getAvailableProviders(): ProviderName[] {
  const available: ProviderName[] = ["openai"]; // OpenAI uses fetch, always available

  if (AnthropicProvider.isAvailable()) available.push("anthropic");
  if (GeminiProvider.isAvailable()) available.push("gemini");
  if (GroqProvider.isAvailable()) available.push("groq");
  if (CerebrasProvider.isAvailable()) available.push("cerebras");

  return available;
}
