import { AzureOpenAI, OpenAI } from '../../index';
import { OpenAIError } from '../../error';
import type { RealtimeClientEvent, RealtimeServerEvent } from '../../resources/beta/realtime/realtime';
import { OpenAIRealtimeEmitter, buildRealtimeURL, isAzure } from './internal-base';
import { isRunningInBrowser } from '../../internal/detect-platform';

interface MessageEvent {
  data: string;
}

type _WebSocket =
  typeof globalThis extends (
    {
      WebSocket: infer ws extends abstract new (...args: any) => any;
    }
  ) ?
    // @ts-ignore
    InstanceType<ws>
  : any;

export class OpenAIRealtimeWebSocket extends OpenAIRealtimeEmitter {
  url: URL;
  socket: _WebSocket;

  constructor(
    props: {
      model: string;
      dangerouslyAllowBrowser?: boolean;
      /**
       * Callback to mutate the URL, needed for Azure.
       * @internal
       */
      onURL?: (url: URL) => void;
    },
    client?: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  ) {
    super();

    const dangerouslyAllowBrowser =
      props.dangerouslyAllowBrowser ??
      (client as any)?._options?.dangerouslyAllowBrowser ??
      (typeof (client as any)?._options?.apiKey === 'string' && client?.apiKey?.startsWith('ek_') ?
        true
      : null);
    if (!dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new OpenAIError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\n\nYou can avoid this error by creating an ephemeral session token:\nhttps://platform.openai.com/docs/api-reference/realtime-sessions\n",
      );
    }

    client ??= new OpenAI({ dangerouslyAllowBrowser });

    if (typeof (client as any)?._options?.apiKey !== 'string') {
      throw new Error('Call the create method instead to construct the client');
    }

    this.url = buildRealtimeURL(client, props.model);
    props.onURL?.(this.url);

    // @ts-ignore
    this.socket = new WebSocket(this.url.toString(), [
      'realtime',
      ...(isAzure(client) ? [] : [`openai-insecure-api-key.${client.apiKey}`]),
      'openai-beta.realtime-v1',
    ]);

    this.socket.addEventListener('message', (websocketEvent: MessageEvent) => {
      const event = (() => {
        try {
          return JSON.parse(websocketEvent.data.toString()) as RealtimeServerEvent;
        } catch (err) {
          this._onError(null, 'could not parse websocket event', err);
          return null;
        }
      })();

      if (event) {
        this._emit('event', event);

        if (event.type === 'error') {
          this._onError(event);
        } else {
          // @ts-expect-error TS isn't smart enough to get the relationship right here
          this._emit(event.type, event);
        }
      }
    });

    this.socket.addEventListener('error', (event: any) => {
      this._onError(null, event.message, null);
    });

    if (isAzure(client)) {
      if (this.url.searchParams.get('Authorization') !== null) {
        this.url.searchParams.set('Authorization', '<REDACTED>');
      } else {
        this.url.searchParams.set('api-key', '<REDACTED>');
      }
    }
  }

  static async create(
    client: Pick<OpenAI, 'apiKey' | 'baseURL' | '_setApiKey'>,
    props: { model: string; dangerouslyAllowBrowser?: boolean },
  ): Promise<OpenAIRealtimeWebSocket> {
    await client._setApiKey();
    return new OpenAIRealtimeWebSocket(props, client);
  }

  static async azure(
    client: Pick<AzureOpenAI, '_setApiKey' | 'apiVersion' | 'apiKey' | 'baseURL' | 'deploymentName'>,
    options: { deploymentName?: string; dangerouslyAllowBrowser?: boolean } = {},
  ): Promise<OpenAIRealtimeWebSocket> {
    const isToken = await client._setApiKey();
    function onURL(url: URL) {
      if (isToken) {
        url.searchParams.set('Authorization', `Bearer ${client.apiKey}`);
      } else {
        url.searchParams.set('api-key', client.apiKey);
      }
    }
    const deploymentName = options.deploymentName ?? client.deploymentName;
    if (!deploymentName) {
      throw new Error('No deployment name provided');
    }
    const { dangerouslyAllowBrowser } = options;
    return new OpenAIRealtimeWebSocket(
      {
        model: deploymentName,
        onURL,
        ...(dangerouslyAllowBrowser ? { dangerouslyAllowBrowser } : {}),
      },
      client,
    );
  }

  send(event: RealtimeClientEvent) {
    try {
      this.socket.send(JSON.stringify(event));
    } catch (err) {
      this._onError(null, 'could not send data', err);
    }
  }

  close(props?: { code: number; reason: string }) {
    try {
      this.socket.close(props?.code ?? 1000, props?.reason ?? 'OK');
    } catch (err) {
      this._onError(null, 'could not close the connection', err);
    }
  }
}
