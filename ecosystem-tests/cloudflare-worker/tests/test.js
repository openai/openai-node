it(
	'works',
	async () => {
		const response = await fetch('http://localhost:8787/test');
		expect(await response.text()).toEqual('Passed!');
	},
	3 * 60_000
);
