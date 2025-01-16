import { OpenAI } from '../../index';
import { OpenAIError } from '../../error';
import * as Core from '../../core';
import type { RealtimeClientEvent, RealtimeServerEvent } from '../../resources/beta/realtime/realtime';
import { OpenAIRealtimeEmitter, buildRealtimeURL } from './internal-base';

interface MessageEvent {
  data: string;
}

type _WebSocket =
  typeof globalThis extends (
    {
      WebSocket: infer ws;
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
    },
    client?: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  ) {
    super();

    const dangerouslyAllowBrowser =
      props.dangerouslyAllowBrowser ??
      (client as any)?._options?.dangerouslyAllowBrowser ??
      (client?.apiKey.startsWith('ek_') ? true : null);

    if (!dangerouslyAllowBrowser && Core.isRunningInBrowser()) {
      throw new OpenAIError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\n\nYou can avoid this error by creating an ephemeral session token:\nhttps://platform.openai.com/docs/api-reference/realtime-sessions\n",
      );
    }

    client ??= new OpenAI({ dangerouslyAllowBrowser });

    this.url = buildRealtimeURL({ baseURL: client.baseURL, model: props.model });
    // @ts-ignore
    this.socket = new WebSocket(this.url, [
      'realtime',
      `openai-insecure-api-key.${client.apiKey}`,
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
