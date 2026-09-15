// The local health check must not load API keys or Worker secrets.
process.env = Object.fromEntries(
	Object.entries(process.env).filter(
		([name]) =>
			!['openai_api_key', 'cloudflare_include_process_env', 'cloudflare_load_dev_vars_from_dot_env'].includes(
				name.toLowerCase(),
			),
	),
);

process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
