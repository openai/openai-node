import assert from 'node:assert/strict';
import { test } from 'node:test';

test('serves the health check through the local Wrangler runtime', async () => {
	const response = await fetch('http://127.0.0.1:8787/', {
		signal: AbortSignal.timeout(5000),
	});

	assert.equal(response.status, 200);
	assert.equal(await response.text(), '');
});
