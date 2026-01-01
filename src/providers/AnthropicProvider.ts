import { BaseProvider } from "./BaseProvider";
import type { CompletionOptions, CompletionResult } from "../types";

/**
 * Anthropic provider using the official @anthropic-ai/sdk package
 */
export class AnthropicProvider extends BaseProvider {
  private client: unknown;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      // Dynamic import to make the SDK optional
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({
        apiKey: this.apiKey,
        ...(this.baseUrl && { baseURL: this.baseUrl }),
      });
    } catch {
      throw new Error(
        "Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk"
      );
    }
  }

  getDefaultModel(): string {
    return "claude-3-haiku-20240307";
  }

  getName(): string {
    return "anthropic";
  }

  static isAvailable(): boolean {
    try {
      require.resolve("@anthropic-ai/sdk");
      return true;
    } catch {
      return false;
    }
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const {
      systemPrompt,
      userPrompt,
      maxTokens = 1000,
      temperature = 0.3,
    } = options;

    if (!this.client) {
      await this.initClient();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.client as any;
    const message = await client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    return {
      content: message.content[0]?.text || "",
      usage: {
        inputTokens: message.usage?.input_tokens || 0,
        outputTokens: message.usage?.output_tokens || 0,
      },
    };
  }
}
