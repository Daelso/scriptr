import OpenAI from "openai";
import type { Config } from "@/lib/config";

export class MissingKeyError extends Error {
  constructor() {
    super("XAI_API_KEY is not configured. Set it in Settings or .env.local.");
  }
}

export function getGrokClient(config: Config): OpenAI {
  if (!config.apiKey) throw new MissingKeyError();
  return new OpenAI({ apiKey: config.apiKey, baseURL: "https://api.x.ai/v1" });
}
