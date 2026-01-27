import { BaseProvider } from "./BaseProvider";
import type { CompletionOptions, CompletionResult } from "../types";

/**
 * Groq provider using the official groq-sdk package
 */
export class GroqProvider extends BaseProvider {
  private client: unknown;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      // Dynamic import to make the SDK optional
      const { default: Groq } = await import("groq-sdk");
      this.client = new Groq({
        apiKey: this.apiKey,
        ...(this.baseUrl && { baseURL: this.baseUrl }),
      });
    } catch {
      throw new Error("Groq SDK not installed. Run: npm install groq-sdk");
    }
  }

  getDefaultModel(): string {
    return "llama-3.3-70b-versatile";
  }

  getName(): string {
    return "groq";
  }

  static isAvailable(): boolean {
    try {
      require.resolve("groq-sdk");
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
      max_tokens: maxTokens,
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
