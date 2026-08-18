import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { uploadWebApiTestCases } from '../src/uploadWebApiTestCases.ts';
import worker from '../src/worker.ts';

const uploadModule = '../src/uploadWebApiTestCases.js';
const uploadModuleFactory = () => ({ uploadWebApiTestCases });
jest.mock(uploadModule, uploadModuleFactory, { virtual: true });
jest.unstable_mockModule(uploadModule, uploadModuleFactory, {
	virtual: true,
});

const apiKey = 'test-worker-api-key';
const env = { OPENAI_API_KEY: apiKey };

function signedRequest({
	key = apiKey,
	timestamp = Date.now(),
	nonce = randomBytes(16).toString('hex'),
	method = 'POST',
	path = '/test',
	signature,
} = {}) {
	const message = `${method}\n${path}\n${timestamp}\n${nonce}`;
	const digest = signature ?? createHmac('sha256', key).update(message).digest('hex');

	return new Request(`http://localhost:8787${path}`, {
		method,
		headers: {
			authorization: `HMAC-SHA256 ${digest}`,
			'x-worker-timestamp': String(timestamp),
			'x-worker-nonce': nonce,
		},
	});
}

function registerUploadHandlers({ filename = 'finetune.jsonl', assertionError, cleanupError } = {}) {
	const handlers = new Map();
	const create = jest.fn().mockImplementation(() =>
		Promise.resolve({ id: `file-${create.mock.calls.length}`, filename }),
	);
	const remove = jest.fn().mockImplementation(() =>
		cleanupError ? Promise.reject(cleanupError) : Promise.resolve(),
	);

	uploadWebApiTestCases({
		client: { files: { create, delete: remove } },
		it: (description, handler) => handlers.set(description, handler),
		expectEqual: (actual, expected) => {
			if (assertionError) {throw assertionError;}
			expect(actual).toBe(expected);
		},
		expectSimilar: () => {},
	});

	return { handlers, create, remove };
}

it('keeps the health check public but disables public worker deployment URLs', async () => {
	const response = await worker.fetch(new Request('http://localhost:8787/'), { OPENAI_API_KEY: '' }, {});
	const configuration = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf-8');

	expect(response.status).toBe(200);
	expect(configuration).toMatch(/^workers_dev\s*=\s*false$/mu);
	expect(configuration).toMatch(/^preview_urls\s*=\s*false$/mu);
});

it('restricts the billed test route to POST', async () => {
	const response = await worker.fetch(new Request('http://localhost:8787/test'), env, {});

	expect(response.status).toBe(405);
	expect(response.headers.get('allow')).toBe('POST');
});

it('rejects unsigned requests before constructing a client or issuing requests', async () => {
	const fetch = jest.spyOn(globalThis, 'fetch');

	try {
		const response = await worker.fetch(new Request('http://localhost:8787/test', { method: 'POST' }), env, {});

		expect(response.status).toBe(401);
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		fetch.mockRestore();
	}
});

it('fails closed when the signing key is missing', async () => {
	const response = await worker.fetch(signedRequest(), { OPENAI_API_KEY: '' }, {});

	expect(response.status).toBe(401);
});

it('rejects malformed, tampered, stale, and future signatures', async () => {
	const requests = [
		signedRequest({ signature: 'not-a-signature' }),
		signedRequest({ signature: '0'.repeat(64) }),
		signedRequest({ key: 'wrong-api-key' }),
		signedRequest({ nonce: 'invalid-nonce' }),
		signedRequest({ timestamp: Date.now() - 120_000 }),
		signedRequest({ timestamp: Date.now() + 120_000 }),
	];

	const responses = await Promise.all(requests.map((request) => worker.fetch(request, env, {})));
	for (const response of responses) {
		expect(response.status).toBe(401);
	}
});

it('rejects a previously used signed nonce after the first run finishes', async () => {
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rejected', { status: 400 }));
	const request = signedRequest();

	try {
		const first = await worker.fetch(request.clone(), env, {});
		const requestCount = fetch.mock.calls.length;
		const replay = await worker.fetch(request.clone(), env, {});
		expect(first.status).toBe(500);
		expect(requestCount).toBeGreaterThan(0);
		expect(replay.status).toBe(409);
		expect(fetch).toHaveBeenCalledTimes(requestCount);
	} finally {
		fetch.mockRestore();
		consoleError.mockRestore();
	}
});

it('remembers future-dated nonces until their signed timestamp expires', async () => {
	const now = Date.now();
	const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rejected', { status: 400 }));
	const request = signedRequest({ timestamp: now + 59_000 });

	try {
		const first = await worker.fetch(request.clone(), env, {});
		clock.mockReturnValue(now + 61_000);
		const replay = await worker.fetch(request.clone(), env, {});

		expect(first.status).toBe(500);
		expect(replay.status).toBe(409);
	} finally {
		fetch.mockRestore();
		consoleError.mockRestore();
		clock.mockRestore();
	}
});

it('allows only one authenticated test run in a worker isolate', async () => {
	const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
	const response = Promise.withResolvers();
	const started = Promise.withResolvers();
	const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
		started.resolve();
		return response.promise;
	});
	let first;

	try {
		first = worker.fetch(signedRequest(), env, {});
		const state = await Promise.race([
			started.promise.then(() => 'started'),
			first.then(() => 'completed'),
		]);
		expect(state).toBe('started');

		const simultaneous = await worker.fetch(signedRequest(), env, {});
		expect(simultaneous.status).toBe(429);

		response.resolve(new Response('rejected', { status: 400 }));
		const completed = await first;
		expect(completed.status).toBe(500);
	} finally {
		response.resolve(new Response('rejected', { status: 400 }));
		await first;
		fetch.mockRestore();
		consoleError.mockRestore();
	}
});

it('deletes all five uploaded files after successful assertions', async () => {
	const { handlers, create, remove } = registerUploadHandlers();

	const uploadHandlers = [...handlers].filter(([description]) => description.startsWith('toFile handles '));
	await Promise.all(uploadHandlers.map(([, handler]) => handler()));

	expect(create).toHaveBeenCalledTimes(5);
	expect(remove).toHaveBeenCalledTimes(5);
	for (let index = 1; index <= 5; index += 1) {
		expect(remove).toHaveBeenCalledWith(`file-${index}`);
	}
});

it('deletes an uploaded file even when its filename assertion fails', async () => {
	const assertionError = new Error('unexpected file name');
	const { handlers, remove } = registerUploadHandlers({ assertionError });

	await expect(handlers.get('toFile handles Blob')()).rejects.toThrow('unexpected file name');
	expect(remove).toHaveBeenCalledWith('file-1');
});

it('surfaces uploaded-file cleanup failures', async () => {
	const cleanupError = new Error('file deletion failed');
	const { handlers, remove } = registerUploadHandlers({ cleanupError });

	await expect(handlers.get('toFile handles Blob')()).rejects.toThrow('file deletion failed');
	expect(remove).toHaveBeenCalledWith('file-1');
});
