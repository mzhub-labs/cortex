import { BaseProvider } from "./BaseProvider";
import type { CompletionOptions, CompletionResult } from "../types";

/**
 * Cerebras provider using the official @cerebras/cerebras_cloud_sdk package
 */
export class CerebrasProvider extends BaseProvider {
  private client: unknown;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      // Dynamic import to make the SDK optional
      const { default: Cerebras } = await import(
        "@cerebras/cerebras_cloud_sdk"
      );
      this.client = new Cerebras({
        apiKey: this.apiKey,
        ...(this.baseUrl && { baseURL: this.baseUrl }),
      });
    } catch {
      throw new Error(
        "Cerebras SDK not installed. Run: npm install @cerebras/cerebras_cloud_sdk"
      );
    }
  }

  getDefaultModel(): string {
    return "llama-3.3-70b";
  }

  getName(): string {
    return "cerebras";
  }

  static isAvailable(): boolean {
    try {
      require.resolve("@cerebras/cerebras_cloud_sdk");
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
    const completion = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: maxTokens,
      temperature,
    });

    return {
      content: completion.choices[0]?.message?.content || "",
      usage: {
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
      },
    };
  }
}
