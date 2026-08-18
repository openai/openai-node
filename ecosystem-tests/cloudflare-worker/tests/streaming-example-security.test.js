import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

const examples = ['stream-to-client-express.ts', 'stream-to-client-raw.ts'];
const strongToken = '0123456789abcdef0123456789abcdef';

async function* completionStream() {
	yield { choices: [{ delta: { content: 'mock completion' } }] };
}

async function loadExample(filename, environment = {}) {
	const middleware = [];
	const listenCalls = [];
	const runtime = {
		apiCalls: 0,
		bodyParserCalls: 0,
		clientsCreated: 0,
		listenCalls,
		middleware,
		routeHandler: undefined,
	};

	const app = {
		use(handler) {
			middleware.push(handler);
			return app;
		},
		post(_path, handler) {
			runtime.routeHandler = handler;
			return app;
		},
		listen(...args) {
			listenCalls.push(args);
			return app;
		},
	};

	const express = Object.assign(() => app, {
		text: () => (_request, _response, next) => {
			runtime.bodyParserCalls += 1;
			return next();
		},
	});

	class OpenAI {
		constructor() {
			runtime.clientsCreated += 1;
		}

		chat = {
			completions: {
				stream: () => {
					runtime.apiCalls += 1;
					return {
						async *toReadableStream() {
							yield 'mock completion';
						},
					};
				},
				create: () => {
					runtime.apiCalls += 1;
					return completionStream();
				},
			},
		};
	}

	const context = createContext({
		Buffer,
		console: { error() {}, log() {} },
		process: { env: environment },
	});
	const sourceURL = new URL(`../../../examples/chat-completions/${filename}`, import.meta.url);
	const source = ts.transpileModule(await readFile(sourceURL, 'utf-8'), {
		compilerOptions: {
			module: ts.ModuleKind.ES2022,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: filename,
	}).outputText;
	const sourceModule = new SourceTextModule(source, { context, identifier: sourceURL.href });
	const mockModules = new Map([
		['openai', { default: OpenAI }],
		['express', { default: express }],
		['node:crypto', { timingSafeEqual }],
	]);

	await sourceModule.link((specifier) => {
		const exports = mockModules.get(specifier);

		if (!exports) {
			throw new Error(`Unexpected example import: ${specifier}`);
		}

		return new SyntheticModule(
			Object.keys(exports),
			function initializeMockModule() {
				for (const [name, value] of Object.entries(exports)) {
					this.setExport(name, value);
				}
			},
			{ context },
		);
	});

	try {
		await sourceModule.evaluate();
	} catch (error) {
		runtime.error = error;
	}

	return runtime;
}

async function requestExample(runtime, authorization) {
	const request = {
		body: 'hello',
		get(name) {
			return name.toLowerCase() === 'authorization' ? authorization : undefined;
		},
	};
	const response = {
		body: '',
		headers: {},
		statusCode: 200,
		ended: false,
		status(code) {
			this.statusCode = code;
			return this;
		},
		set(name, value) {
			this.headers[name.toLowerCase()] = value;
			return this;
		},
		header(name, value) {
			return this.set(name, value);
		},
		send(body) {
			this.body = body;
			this.ended = true;
			return this;
		},
		write(chunk) {
			this.body += chunk;
			return true;
		},
		end() {
			this.ended = true;
			return this;
		},
	};

	let index = 0;
	let routePromise;
	const dispatch = () => {
		if (index < runtime.middleware.length) {
			const currentMiddleware = runtime.middleware[index];
			index += 1;
			return currentMiddleware(request, response, dispatch);
		}
		routePromise = runtime.routeHandler(request, response);
		return routePromise;
	};

	await dispatch();
	await routePromise;
	return response;
}

describe.each(examples)('%s streaming proxy security', (filename) => {
	it('binds to IPv4 loopback by default and preserves local streaming', async () => {
		const runtime = await loadExample(filename);

		expect(runtime.error).toBeUndefined();
		expect(runtime.listenCalls).toHaveLength(1);
		expect(runtime.listenCalls[0][1]).toBe('127.0.0.1');

		const response = await requestExample(runtime);
		expect(response.statusCode).toBe(200);
		expect(response.body).toBe('mock completion');
		expect(runtime.apiCalls).toBe(1);
	});

	it.each(['::1', 'localhost'])('permits the explicit loopback host %s without authentication', async (host) => {
		const runtime = await loadExample(filename, { OPENAI_EXAMPLE_HOST: host });

		expect(runtime.error).toBeUndefined();
		expect(runtime.listenCalls[0][1]).toBe(host);
		const response = await requestExample(runtime);
		expect(response.statusCode).toBe(200);
	});

	it.each([
		['missing remote opt-in', { OPENAI_EXAMPLE_HOST: '0.0.0.0', OPENAI_EXAMPLE_AUTH_TOKEN: strongToken }],
		['missing authentication token', { OPENAI_EXAMPLE_HOST: '0.0.0.0', OPENAI_EXAMPLE_ALLOW_REMOTE: 'true' }],
		[
			'weak authentication token',
			{
				OPENAI_EXAMPLE_HOST: '0.0.0.0',
				OPENAI_EXAMPLE_ALLOW_REMOTE: 'true',
				OPENAI_EXAMPLE_AUTH_TOKEN: 'short-secret',
			},
		],
		[
			'unrecognized loopback-looking host',
			{ OPENAI_EXAMPLE_HOST: '127.0.0.2', OPENAI_EXAMPLE_AUTH_TOKEN: strongToken },
		],
	])('rejects %s before creating an OpenAI client', async (_description, environment) => {
		const runtime = await loadExample(filename, environment);

		expect(runtime.error).toBeDefined();
		expect(runtime.clientsCreated).toBe(0);
		expect(runtime.listenCalls).toHaveLength(0);
	});

	it('rejects missing and incorrect remote bearer tokens before parsing request bodies', async () => {
		const runtime = await loadExample(filename, {
			OPENAI_EXAMPLE_HOST: '0.0.0.0',
			OPENAI_EXAMPLE_ALLOW_REMOTE: 'true',
			OPENAI_EXAMPLE_AUTH_TOKEN: strongToken,
		});

		expect(runtime.error).toBeUndefined();
		expect(runtime.listenCalls[0][1]).toBe('0.0.0.0');

		const responses = await Promise.all(
			[undefined, `Bearer ${strongToken.slice(0, -1)}x`].map((authorization) => requestExample(runtime, authorization)),
		);
		for (const response of responses) {
			expect(response.statusCode).toBe(401);
			expect(response.headers['www-authenticate']).toBe('Bearer');
		}

		expect(runtime.bodyParserCalls).toBe(0);
		expect(runtime.apiCalls).toBe(0);
	});

	it('accepts the configured remote bearer token and preserves streaming', async () => {
		const runtime = await loadExample(filename, {
			OPENAI_EXAMPLE_HOST: '0.0.0.0',
			OPENAI_EXAMPLE_ALLOW_REMOTE: 'true',
			OPENAI_EXAMPLE_AUTH_TOKEN: strongToken,
		});

		const response = await requestExample(runtime, `Bearer ${strongToken}`);

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe('mock completion');
		expect(runtime.bodyParserCalls).toBe(1);
		expect(runtime.apiCalls).toBe(1);
	});
});
