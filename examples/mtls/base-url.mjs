/** Accepts only the documented OpenAI certificate-bearing API origins. */
export function mtlsBaseURL(configured) {
  let url;
  try {
    url = new URL(configured ?? 'https://mtls.api.openai.com/v1');
  } catch {
    throw new Error('OPENAI_BASE_URL must be a documented OpenAI HTTPS mTLS endpoint.');
  }

  if (
    (url.origin !== 'https://mtls.api.openai.com' && url.origin !== 'https://mtls-eu.api.openai.com') ||
    (url.pathname !== '/v1' && url.pathname !== '/v1/') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('OPENAI_BASE_URL must be a documented OpenAI HTTPS mTLS endpoint.');
  }

  return `${url.origin}/v1`;
}
