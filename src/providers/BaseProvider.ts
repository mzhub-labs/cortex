import type { CompletionOptions, CompletionResult } from "../types";

/**
 * Configuration for provider retry and timeout behavior
 */
export interface ProviderRetryConfig {
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds (default: 1000) */
  retryDelayMs?: number;
}

/**
 * Abstract base class for LLM providers.
 * All provider implementations must extend this class.
 */
export abstract class BaseProvider {
  protected apiKey: string;
  protected model: string;
  protected baseUrl?: string;
  protected timeoutMs: number;
  protected maxRetries: number;
  protected retryDelayMs: number;

  constructor(config: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    retry?: ProviderRetryConfig;
  }) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = config.apiKey;
    this.model = config.model || this.getDefaultModel();
    this.baseUrl = config.baseUrl;

    this.timeoutMs = config.retry?.timeoutMs ?? 30000;
    this.maxRetries = config.retry?.maxRetries ?? 3;
    this.retryDelayMs = config.retry?.retryDelayMs ?? 1000;
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

  /**
   * Execute a fetch request with timeout and retry logic
   */
  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok || !this.isRetryableStatus(response.status)) {
          return response;
        }

        lastError = new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${this.timeoutMs}ms`);
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }

      if (attempt < this.maxRetries) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Check if an HTTP status code is retryable
   */
  private isRetryableStatus(status: number): boolean {
    return (
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    );
  }

  /**
   * Sleep for a given number of milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
