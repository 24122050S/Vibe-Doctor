import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { AiEvalConfig } from '../config/schema.js';

export interface LlmProvider {
  readonly name: string;
  generateJson<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>
  ): Promise<T>;
}

export interface ProviderAvailability {
  available: boolean;
  reason?: string;
}

/**
 * Extracts a JSON object from raw LLM output (handling optional markdown code fences).
 */
export function parseJsonFromLlmText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`LLM output did not contain valid JSON: ${trimmed.slice(0, 160)}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function resolveApiKey(config: AiEvalConfig): string | undefined {
  if (config.api_key_env && process.env[config.api_key_env]) {
    return process.env[config.api_key_env];
  }
  if (config.provider === 'gemini') {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  }
  if (config.provider === 'openai') {
    return process.env.OPENAI_API_KEY;
  }
  return undefined;
}

/**
 * Checks whether the configured LLM provider has credentials/configuration ready.
 */
export function checkProviderAvailability(config: AiEvalConfig): ProviderAvailability {
  if (config.provider === 'ollama') {
    return { available: true };
  }
  const key = resolveApiKey(config);
  if (!key) {
    const envHint =
      config.api_key_env ?? (config.provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY');
    return {
      available: false,
      reason: `Missing ${envHint} environment variable`,
    };
  }
  return { available: true };
}

class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: AiEvalConfig, apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = config.model;
    this.timeoutMs = config.timeout_ms;
  }

  async generateJson<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>
  ): Promise<T> {
    const response = await withTimeout(
      this.client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
      this.timeoutMs,
      `Gemini (${this.model})`
    );

    const rawText = response.text ?? '';
    const parsed = parseJsonFromLlmText(rawText);
    return schema.parse(parsed);
  }
}

class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: AiEvalConfig) {
    this.baseUrl = (config.base_url ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(
      /\/+$/,
      ''
    );
    this.model = config.model;
    this.timeoutMs = config.timeout_ms;
  }

  async generateJson<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const rawText = payload.message?.content ?? '';
    const parsed = parseJsonFromLlmText(rawText);
    return schema.parse(parsed);
  }
}

class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: AiEvalConfig, apiKey: string) {
    this.baseUrl = (config.base_url ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeout_ms;
  }

  async generateJson<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawText = payload.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonFromLlmText(rawText);
    return schema.parse(parsed);
  }
}

/**
 * Factory creating the configured LLM provider (`gemini`, `ollama`, or `openai`).
 */
export function createLlmProvider(config: AiEvalConfig): LlmProvider {
  if (config.provider === 'ollama') {
    return new OllamaProvider(config);
  }

  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    throw new Error(`API key not configured for provider '${config.provider}'`);
  }

  if (config.provider === 'openai') {
    return new OpenAiCompatibleProvider(config, apiKey);
  }

  return new GeminiProvider(config, apiKey);
}
