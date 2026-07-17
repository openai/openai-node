import { jest } from '@jest/globals';
import worker from '../src/worker.ts';

it('keeps the health check response available', async () => {
	const response = await worker.fetch(new Request('http://localhost:8787/'), { OPENAI_API_KEY: '' }, {});

	expect(response.status).toBe(200);
	expect(await response.text()).toBe('');
});

it('does not expose stack traces from unexpected errors', async () => {
	const apiKey = process.env.OPENAI_API_KEY;
	const adminKey = process.env.OPENAI_ADMIN_KEY;
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	delete process.env.OPENAI_API_KEY;
	delete process.env.OPENAI_ADMIN_KEY;

	try {
		const response = await worker.fetch(
			new Request('http://localhost:8787/test'),
			{ OPENAI_API_KEY: '' },
			{},
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
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
		consoleError.mockRestore();
	}
});

it('does not expose stack traces from failed test handlers', async () => {
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sensitive stack trace'));

	try {
		const response = await worker.fetch(
			new Request('http://localhost:8787/test'),
			{ OPENAI_API_KEY: 'test-key' },
			{},
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
	} finally {
		fetch.mockRestore();
		consoleError.mockRestore();
	}
});
