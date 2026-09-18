# Webhooks

Types:

- <code><a href="./src/resources/webhooks/webhooks.ts">BatchCancelledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">BatchCompletedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">BatchExpiredWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">BatchFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">DeletedWebhookEndpoint</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">EvalRunCanceledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">EvalRunFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">EvalRunSucceededWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">FineTuningJobCancelledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">FineTuningJobFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">FineTuningJobSucceededWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">LiveCallIncomingWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">LiveTransportIncomingWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">RealtimeCallIncomingWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">ResponseCancelledWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">ResponseCompletedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">ResponseFailedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">ResponseIncompleteWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">SafetyAlertCreatedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">SafetyDeactivationIssuedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">SafetyOrgAlertCreatedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">SafetyWarningIssuedWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">UnwrapWebhookEvent</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">WebhookEndpoint</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">WebhookEndpointList</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">WebhookEndpointTestResult</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">WebhookEndpointWithSecret</a></code>
- <code><a href="./src/resources/webhooks/webhooks.ts">WebhookEventTypeList</a></code>

Methods:

- <code title="post /webhook_endpoints">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">create</a>({ ...params }) -> WebhookEndpointWithSecret</code>
- <code title="get /webhook_endpoints/{webhook_endpoint_id}">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">retrieve</a>(webhookEndpointID) -> WebhookEndpoint</code>
- <code title="post /webhook_endpoints/{webhook_endpoint_id}">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">update</a>(webhookEndpointID, { ...params }) -> WebhookEndpoint</code>
- <code title="get /webhook_endpoints">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">list</a>({ ...params }) -> WebhookEndpointsPage</code>
- <code title="delete /webhook_endpoints/{webhook_endpoint_id}">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">delete</a>(webhookEndpointID) -> DeletedWebhookEndpoint</code>
- <code title="post /webhook_endpoints/{webhook_endpoint_id}/rotate_secret">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">rotateSecret</a>(webhookEndpointID, { ...params }) -> WebhookEndpointWithSecret</code>
- <code title="post /webhook_endpoints/{webhook_endpoint_id}/test">client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">test</a>(webhookEndpointID, { ...params }) -> WebhookEndpointTestResult</code>
- <code>client.webhooks.<a href="./src/resources/webhooks/webhooks.ts">unwrap</a>(body) -> void</code>

## EventTypes

Methods:

- <code title="get /webhook_event_types">client.webhooks.eventTypes.<a href="./src/resources/webhooks/event-types.ts">list</a>() -> WebhookEventTypeList</code>
