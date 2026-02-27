#!/usr/bin/env node
import 'dotenv/config';

(async () => {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello, Claude' }],
      model: 'claude-sonnet-4-6'
    });

    if (message && message.content) {
      console.log(message.content);
    } else {
      console.log('No content in response');
    }
  } catch (err) {
    console.error('Error calling Anthropic API:', err?.message || err);
    process.exitCode = 1;
  }
})();
