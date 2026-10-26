// oxlint-disable-next-line no-restricted-imports -- This fixture is copied into an installed SDK consumer.
import OpenAI from 'openai';
// oxlint-disable-next-line no-restricted-imports -- Check the public provider subpath in the installed package.
import { vertex } from 'openai/providers/vertex';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

/** Type-check Google's concrete and inferred auth clients against the public Vertex provider. */
export async function createVertexClients() {
  const credentials = await new GoogleAuth().getClient();
  return [
    new OpenAI({
      provider: vertex({ project: 'fixture', location: 'global', credentials: new OAuth2Client() }),
    }),
    new OpenAI({ provider: vertex({ project: 'fixture', location: 'global', credentials }) }),
  ];
}
