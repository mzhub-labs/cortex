import { BaseProvider } from "./BaseProvider";
import type { CompletionOptions, CompletionResult } from "../types";

/**
 * OpenAI provider using native fetch (no SDK required)
 */
export class OpenAIProvider extends BaseProvider {
  private endpoint: string;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    super(config);
    this.endpoint = this.baseUrl || "https://api.openai.com/v1";
  }

  getDefaultModel(): string {
    return "gpt-4o-mini";
  }

  getName(): string {
    return "openai";
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const {
      systemPrompt,
      userPrompt,
      maxTokens = 1000,
      temperature = 0.3,
      jsonMode = true,
    } = options;

    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature,
        ...(jsonMode && { response_format: { type: "json_object" } }),
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))) as {
        error?: { message?: string };
      };
      throw new Error(
        `OpenAI API error: ${errorData.error?.message || response.statusText}`
      );
    }

    interface OpenAIResponse {
      choices: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }

    const data = (await response.json()) as OpenAIResponse;

    return {
      content: data.choices[0]?.message?.content || "",
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
    };
  }
}
