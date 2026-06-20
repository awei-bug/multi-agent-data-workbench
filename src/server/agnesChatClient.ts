type AgnesChatClientOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

export function createAgnesChatClient(options: AgnesChatClientOptions) {
  const baseUrl = options.baseUrl ?? 'https://apihub.agnes-ai.com/v1';
  const model = options.model ?? 'Agnes 2.0 Flash';

  return {
    async complete(prompt: string) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Agnes API request failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      return payload.choices?.[0]?.message?.content?.trim() ?? '';
    },
  };
}
