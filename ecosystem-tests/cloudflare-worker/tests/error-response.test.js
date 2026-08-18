import { createHmac, randomBytes } from 'node:crypto';
import { jest } from '@jest/globals';
import { uploadWebApiTestCases } from '../src/uploadWebApiTestCases.ts';
import worker from '../src/worker.ts';

const uploadModule = '../src/uploadWebApiTestCases.js';
const uploadModuleFactory = () => ({ uploadWebApiTestCases });
jest.mock(uploadModule, uploadModuleFactory, { virtual: true });
jest.unstable_mockModule(uploadModule, uploadModuleFactory, { virtual: true });

function authenticatedRequest(apiKey) {
	const timestamp = String(Date.now());
	const nonce = randomBytes(16).toString('hex');
	const signature = createHmac('sha256', apiKey)
		.update(`POST\n/test\n${timestamp}\n${nonce}`)
		.digest('hex');

	return new Request('http://localhost:8787/test', {
		method: 'POST',
		headers: {
			authorization: `HMAC-SHA256 ${signature}`,
			'x-worker-timestamp': timestamp,
			'x-worker-nonce': nonce,
		},
	});
}

it('keeps the health check response available', async () => {
	const response = await worker.fetch(new Request('http://localhost:8787/'), { OPENAI_API_KEY: '' }, {});

	expect(response.status).toBe(200);
	expect(await response.text()).toBe('');
});

it('does not expose stack traces from unexpected errors', async () => {
	const apiKey = process.env.OPENAI_API_KEY;
	const adminKey = process.env.OPENAI_ADMIN_KEY;
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	const fetch = jest.spyOn(globalThis, 'fetch');
	let apiKeyReads = 0;
	const env = {
		get OPENAI_API_KEY() {
			if (apiKeyReads === 0) {
				apiKeyReads += 1;
				return 'test-key';
			}
			throw new Error('sensitive stack trace');
		},
	};
	delete process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_ADMIN_KEY;

	try {
		const response = await worker.fetch(
			authenticatedRequest('test-key'),
			env,
			{},
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		if (apiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = apiKey;
		}
		if (adminKey === undefined) {
			delete process.env.OPENAI_ADMIN_KEY;
		} else {
			process.env.OPENAI_ADMIN_KEY = adminKey;
		}
		fetch.mockRestore();
		consoleError.mockRestore();
	}
});

it('does not expose stack traces from failed test handlers', async () => {
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sensitive stack trace'));

	try {
		const response = await worker.fetch(
			authenticatedRequest('test-key'),
			{ OPENAI_API_KEY: 'test-key' },
			{},
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
		expect(fetch).toHaveBeenCalled();
	} finally {
		fetch.mockRestore();
		consoleError.mockRestore();
	}
});
