import { expectTypeOf, test } from 'vitest';
import type { CursorPageParams, TokenPageParams } from 'openai/core/pagination';
import type { AdminAPIKeyListParams } from 'openai/resources/admin/organization/admin-api-keys';
import type { AgentListParams } from 'openai/resources/beta/agents/agents';
import type { FileListParams } from 'openai/resources/beta/agents/environments/files';
import type { ArtifactListParams } from 'openai/resources/beta/agents/sessions/artifacts';
import type { SessionListParams } from 'openai/resources/beta/agents/sessions/sessions';
import type { CredentialListParams } from 'openai/resources/beta/agents/vaults/credentials';
import type { VaultListParams } from 'openai/resources/beta/agents/vaults/vaults';
import type { WebhookListParams } from 'openai/resources/webhooks/webhooks';

test('preserves schema-nullable inherited list parameters', () => {
  expectTypeOf<WebhookListParams['after']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<AdminAPIKeyListParams['after']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<ArtifactListParams['after']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<ArtifactListParams['limit']>().toEqualTypeOf<number | null | undefined>();
  expectTypeOf<AgentListParams['limit']>().toEqualTypeOf<number | null | undefined>();
  expectTypeOf<FileListParams['limit']>().toEqualTypeOf<number | null | undefined>();
  expectTypeOf<SessionListParams['limit']>().toEqualTypeOf<number | null | undefined>();
  expectTypeOf<CredentialListParams['limit']>().toEqualTypeOf<number | null | undefined>();
  expectTypeOf<VaultListParams['limit']>().toEqualTypeOf<number | null | undefined>();
});

test('keeps shared pagination parameters narrow and existing callers compatible', () => {
  expectTypeOf<CursorPageParams['after']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<CursorPageParams['limit']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<TokenPageParams['limit']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<WebhookListParams['limit']>().toEqualTypeOf<number | undefined>();
  const original: CursorPageParams = { after: 'whe_synthetic', limit: 1 };
  const accepted: WebhookListParams = original;
  expect(accepted).toBe(original);
});
