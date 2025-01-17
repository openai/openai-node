import * as WS from 'ws';
import { OpenAI } from '../../index';
import type { RealtimeClientEvent, RealtimeServerEvent } from '../../resources/beta/realtime/realtime';
import { OpenAIRealtimeEmitter, buildRealtimeURL } from './internal-base';

export class OpenAIRealtimeWS extends OpenAIRealtimeEmitter {
  url: URL;
  socket: WS.WebSocket;

  constructor(
    props: { model: string; options?: WS.ClientOptions | undefined },
    client?: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  ) {
    super();
    client ??= new OpenAI();

    this.url = buildRealtimeURL({ baseURL: client.baseURL, model: props.model });
    this.socket = new WS.WebSocket(this.url, {
      ...props.options,
      headers: {
        ...props.options?.headers,
        Authorization: `Bearer ${client.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

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
