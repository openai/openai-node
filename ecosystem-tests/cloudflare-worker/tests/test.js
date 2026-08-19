import { createHmac, randomBytes } from 'node:crypto';

it(
	'works',
	async () => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {throw new Error('OPENAI_API_KEY is required to authorize the worker test');}
		const timestamp = String(Date.now());
		const nonce = randomBytes(16).toString('hex');
		const signature = createHmac('sha256', apiKey)
			.update(`POST\n/test\n${timestamp}\n${nonce}`)
			.digest('hex');
		const response = await fetch('http://localhost:8787/test', {
			method: 'POST',
			headers: {
				authorization: `HMAC-SHA256 ${signature}`,
				'x-worker-timestamp': timestamp,
				'x-worker-nonce': nonce,
			},
		});
		expect(await response.text()).toEqual('Passed!');
	},
	3 * 60_000
);
