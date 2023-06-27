import OpenAI from 'openai';
import { uploadWebApiTestCases } from './uploadWebApiTestCases.js';
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

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

		const tests: Test[] = [];
		function it(description: string, handler: () => Promise<void>) {
			tests.push({ description, handler });
		}
		function expectEqual(a: any, b: any) {
			if (!Object.is(a, b)) {
				throw new Error(`expected values to be equal: ${JSON.stringify({ a, b })}`);
			}
		}
		uploadWebApiTestCases({
			client: client as any,
			it,
			expectEqual,
		});

		let allPassed = true;
		const results = [];

		for (const { description, handler } of tests) {
			let result;
			try {
				result = await handler();
			} catch (error) {
				allPassed = false;
				result = error instanceof Error ? error.stack : String(error);
			}
			results.push(`${description}\n\n${String(result)}`);
		}

		return new Response(allPassed ? 'Passed!' : results.join('\n\n'));
	},
};
