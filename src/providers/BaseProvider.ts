import type { CompletionOptions, CompletionResult } from "../types";

/**
 * Abstract base class for LLM providers.
 * All provider implementations must extend this class.
 */
export abstract class BaseProvider {
  protected apiKey: string;
  protected model: string;
  protected baseUrl?: string;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = config.apiKey;
    this.model = config.model || this.getDefaultModel();
    this.baseUrl = config.baseUrl;
  }

  /**
   * Get the default model for this provider
   */
  abstract getDefaultModel(): string;

  /**
   * Get the provider name
   */
  abstract getName(): string;

  /**
   * Generate a completion from the LLM
   */
  abstract complete(options: CompletionOptions): Promise<CompletionResult>;

  /**
   * Check if the provider SDK is available
   */
  static isAvailable(): boolean {
    return true;
  }
}
