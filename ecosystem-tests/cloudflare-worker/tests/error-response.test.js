import { jest } from '@jest/globals';
import worker from '../src/worker.ts';

it('keeps the health check response available', async () => {
	const response = await worker.fetch(new Request('http://localhost:8787/'), { OPENAI_API_KEY: '' }, {});

	expect(response.status).toBe(200);
	expect(await response.text()).toBe('');
});

it('does not expose stack traces from unexpected errors', async () => {
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

	try {
		const response = await worker.fetch(
			new Request('http://localhost:8787/test'),
			{ OPENAI_API_KEY: '' },
			{},
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
	} finally {
		consoleError.mockRestore();
	}
});
