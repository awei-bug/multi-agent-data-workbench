import { createWorkspaceApiServer } from '../src/server/createWorkspaceApiServer.ts';

const apiKey = process.env.AGNES_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.APIHUB_API_KEY;

if (!apiKey) {
  throw new Error('Missing Agnes API key in environment');
}

const port = Number(process.env.WORKSPACE_API_PORT ?? 8787);
const server = createWorkspaceApiServer({
  apiKey,
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  model: 'Agnes 2.0 Flash',
});

server.listen(port, () => {
  console.log(`workspace api listening on http://localhost:${port}`);
});
