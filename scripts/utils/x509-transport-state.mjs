import * as browserState from './x509-transport-state-browser.mjs';
import * as nodeState from './x509-transport-state.js';

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- The package adapter probes the Node-only registry export before selecting the browser fallback.
const state = typeof nodeState.findRegisteredX509Transport === 'function' ? nodeState : browserState;

export const {
  findRegisteredX509Transport,
  rememberRegisteredX509Transport,
  markTransientX509ConnectionError,
  isTransientX509ConnectionError,
  markRetryableX509IssuerError,
  isRetryableX509IssuerError,
  markApprovedX509Client,
  isApprovedX509Client,
  rememberX509OAuthError,
  findX509OAuthError,
  rememberX509Credential,
  findX509Credential,
} = state;
