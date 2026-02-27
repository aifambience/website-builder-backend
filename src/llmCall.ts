import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "./env.js";

const { llmApiKey } = getEnv();

const client = new Anthropic({
  apiKey: llmApiKey,
});

const message = await client.messages.create({
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude" }],
  model: "claude-sonnet-4-6"
});

console.log(message.content);
