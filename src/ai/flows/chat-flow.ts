'use server';
/**
 * @fileOverview Basic chatbot flow using Genkit.
 *
 * - chatFlow - Handles the chat conversation.
 * - ChatFlowInput - Input schema for the chat flow.
 * - ChatFlowOutput - Output schema for the chat flow.
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';

const ChatFlowInputSchema = z.object({
  message: z.string().describe('The user message to the chatbot.'),
  // Optional: Add history if needed
  // history: z.array(z.object({ role: z.enum(['user', 'model']), content: z.string() })).optional(),
});
export type ChatFlowInput = z.infer<typeof ChatFlowInputSchema>;

const ChatFlowOutputSchema = z.object({
  answer: z.string().describe('The chatbot response message.'),
});
export type ChatFlowOutput = z.infer<typeof ChatFlowOutputSchema>;


// Define the prompt template
const chatPrompt = ai.definePrompt({
    name: 'chatPrompt',
    input: { schema: ChatFlowInputSchema },
    output: { schema: ChatFlowOutputSchema },
    prompt: `You are a helpful assistant integrated into a Playwright-to-Robot-Framework conversion tool.
Answer the user's question concisely.

User message: {{{message}}}
Answer:`,
    // Optional: Include history in the prompt if used
    // prompt: `{{#if history}}
    // {{#each history}}
    // {{#if (eq role "user")}}User: {{content}}{{/if}}
    // {{#if (eq role "model")}}Assistant: {{content}}{{/if}}
    // {{/each}}
    // {{/if}}
    // User: {{{message}}}
    // Assistant:`,
});

// Define the flow
const internalChatFlow = ai.defineFlow<
  typeof ChatFlowInputSchema,
  typeof ChatFlowOutputSchema
>(
  {
    name: 'chatFlow',
    inputSchema: ChatFlowInputSchema,
    outputSchema: ChatFlowOutputSchema,
  },
  async (input) => {
    const { output } = await chatPrompt(input);
    if (!output) {
      throw new Error('Chat prompt failed to generate output.');
    }
    return output;
  }
);

// Exported wrapper function
export async function chatFlow(input: ChatFlowInput): Promise<ChatFlowOutput> {
  return internalChatFlow(input);
}
