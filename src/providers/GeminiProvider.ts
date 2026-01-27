import { BaseProvider } from "./BaseProvider";
import type { CompletionOptions, CompletionResult } from "../types";

/**
 * Google Gemini provider using the official @google/generative-ai package
 */
export class GeminiProvider extends BaseProvider {
  private genAI: unknown;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      // Dynamic import to make the SDK optional
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      this.genAI = new GoogleGenerativeAI(this.apiKey);
    } catch {
      throw new Error(
        "Google Generative AI SDK not installed. Run: npm install @google/generative-ai"
      );
    }
  }

  getDefaultModel(): string {
    return "gemini-2.0-flash";
  }

  getName(): string {
    return "gemini";
  }

  static isAvailable(): boolean {
    try {
      require.resolve("@google/generative-ai");
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

    if (!this.genAI) {
      await this.initClient();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const genAI = this.genAI as any;
    const model = genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    });

    const response = result.response;

    return {
      content: response.text() || "",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }
}
