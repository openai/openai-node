import * as WS from 'ws';
import { AzureOpenAI, OpenAI } from '../../index';
import type { RealtimeClientEvent, RealtimeServerEvent } from '../../resources/beta/realtime/realtime';
import { OpenAIRealtimeEmitter, buildRealtimeURL } from './internal-base';

export class OpenAIRealtimeWS extends OpenAIRealtimeEmitter {
  url: URL;
  socket: WS.WebSocket;
  options: WS.ClientOptions | undefined;

  constructor(
    props: { model: string; options?: WS.ClientOptions | undefined },
    private client: Pick<OpenAI, 'apiKey' | 'baseURL'> = new OpenAI(),
  ) {
    super();
    this.options = props.options;
    this.url = buildRealtimeURL(client, props.model);
    this.socket = undefined as any;
  }

  async open(): Promise<void> {
    const headers = {
      ...this.options?.headers,
      'OpenAI-Beta': 'realtime=v1',
    };
    if (this.client instanceof AzureOpenAI) {
      if (this.client.apiKey !== '<Missing Key>') {
        this.socket = new WS.WebSocket(this.url, {
          ...this.options,
          headers: {
            ...headers,
            'api-key': this.client.apiKey,
          },
        });
      } else {
        const token = await this.client.getAzureADToken();
        if (token) {
          this.socket = new WS.WebSocket(this.url, {
            ...this.options,
            headers: {
              ...headers,
              Authorization: `Bearer ${token}`,
            },
          });
        } else {
          throw new Error('AzureOpenAI is not instantiated correctly. No API key or token provided.');
        }
      }
    } else {
      this.socket = new WS.WebSocket(this.url, {
        ...this.options,
        headers: {
          ...headers,
          Authorization: `Bearer ${this.client.apiKey}`,
        },
      });
    }

    this.socket.on('message', (wsEvent) => {
      const event = (() => {
        try {
          return JSON.parse(wsEvent.toString()) as RealtimeServerEvent;
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

    this.socket.on('error', (err) => {
      this._onError(null, err.message, err);
    });
  }

  send(event: RealtimeClientEvent) {
    if (!this.socket) {
      throw new Error('The socket is not open, call `open` first');
    }
    try {
      this.socket.send(JSON.stringify(event));
    } catch (err) {
      this._onError(null, 'could not send data', err);
    }
  }

  close(props?: { code: number; reason: string }) {
    try {
      this.socket?.close(props?.code ?? 1000, props?.reason ?? 'OK');
    } catch (err) {
      this._onError(null, 'could not close the connection', err);
    }
  }
}
