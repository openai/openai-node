import { distance } from 'fastest-levenshtein';

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;

	OPENAI_API_KEY: string;
}

type Test = { description: string; handler: () => Promise<void> };

const MAX_SIGNATURE_AGE_MS = 60_000;
const MAX_USED_NONCES = 1024;
const usedNonces = new Map<string, number>();
let activeTestRun = false;

async function authenticateTestRequest(request: Request, apiKey: string): Promise<string | undefined> {
	const authorization = request.headers.get('authorization');
	const timestampHeader = request.headers.get('x-worker-timestamp');
	const nonce = request.headers.get('x-worker-nonce');

	if (
		!apiKey ||
		!authorization ||
		!/^HMAC-SHA256 [a-f0-9]{64}$/u.test(authorization) ||
		!timestampHeader ||
		!/^\d{13}$/u.test(timestampHeader) ||
		!nonce ||
		!/^[a-f0-9]{32}$/u.test(nonce)
	) {
		return undefined;
	}

	const timestamp = Number(timestampHeader);
	if (Math.abs(Date.now() - timestamp) > MAX_SIGNATURE_AGE_MS) {
		return undefined;
	}

	const digest = authorization.slice('HMAC-SHA256 '.length);
	const signature = new Uint8Array(digest.length / 2);
	for (let index = 0; index < signature.length; index += 1) {
		signature[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
	}

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(apiKey),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
	const url = new URL(request.url);
	const message = encoder.encode(`${request.method}\n${url.pathname}\n${timestampHeader}\n${nonce}`);
	const valid = await crypto.subtle.verify('HMAC', key, signature, message);

	return valid ? nonce : undefined;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		// start-server-and-test polls / to see if the server is up and running
		if (url.pathname === '/') {return new Response();}
		// then the test code requests /test
		if (url.pathname !== '/test') {return new Response(null, { status: 404 });}
		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
		}

		let nonce: string | undefined;
		try {
			nonce = await authenticateTestRequest(request, env.OPENAI_API_KEY);
		} catch {
			return new Response('Unauthorized', { status: 401 });
		}
		if (!nonce) {return new Response('Unauthorized', { status: 401 });}

		const now = Date.now();
		for (const [usedNonce, timestamp] of usedNonces) {
			if (now - timestamp > MAX_SIGNATURE_AGE_MS) {usedNonces.delete(usedNonce);}
		}
		if (usedNonces.has(nonce)) {return new Response('Conflict', { status: 409 });}
		if (activeTestRun || usedNonces.size >= MAX_USED_NONCES) {
			return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '1' } });
		}

		usedNonces.set(nonce, Number(request.headers.get('x-worker-timestamp')));
		activeTestRun = true;
		try {
			console.error('importing openai');
			const { default: OpenAI } = await import('openai');
			console.error('importing test cases');
			const { uploadWebApiTestCases } = await import('./uploadWebApiTestCases.js');
			console.error('creating client');
			const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
			console.error('created client');

			const tests: Test[] = [];
			const it = (description: string, handler: () => Promise<void>) => {
				tests.push({ description, handler });
			};
			const expectEqual = (a: any, b: any) => {
				if (!Object.is(a, b)) {
					throw new Error(`expected values to be equal: ${JSON.stringify({ a, b })}`);
				}
			};
			const expectSimilar = (received: string, expected: string, maxDistance: number) => {
				const receivedDistance = distance(received, expected);
				if (receivedDistance < maxDistance) {
					return;
				}

				const message = [
					`Received: ${JSON.stringify(received)}`,
					`Expected: ${JSON.stringify(expected)}`,
					`Max distance: ${maxDistance}`,
					`Received distance: ${receivedDistance}`,
				].join('\n');

				throw new Error(message);
			};

			uploadWebApiTestCases({
				client: client as any,
				it,
				expectEqual,
				expectSimilar,
			});

			for (const { description, handler } of tests) {
				console.error('running', description);
				try {
					await handler();
					console.error('passed', description);
				} catch (error) {
					console.error('failed', description, error);
					return new Response('Internal Server Error', { status: 500 });
				}
			}

			return new Response('Passed!');
		} catch (error) {
			console.error(error instanceof Error ? error.stack : String(error));
			return new Response('Internal Server Error', { status: 500 });
		} finally {
			activeTestRun = false;
		}
	},
};
