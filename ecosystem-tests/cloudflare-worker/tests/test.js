import fetch from 'node-fetch';

it(
	'works',
	async () => {
		expect(await (await fetch('http://localhost:8787')).text()).toEqual('Passed!');
	},
	3 * 60000
);
