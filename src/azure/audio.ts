import { Audio, Transcriptions, Translations } from '../resources/audio';
import type { OpenAI } from '../index';

class AzureTranslation extends Translations {
  constructor(
    client: OpenAI,
    private _deployments: string[],
  ) {
    super(client);
  }
  // @ts-ignore we don't want to redeclare all the method signatures
  override create(...args: Parameters<Translations['create']>): ReturnType<Translations['create']> {
    this._deployments.push(args[0].model);
    return super.create(args[0], args[1]);
  }
}

class AzureTranscription extends Transcriptions {
  constructor(
    client: OpenAI,
    private _deployments: string[],
  ) {
    super(client);
  }
  // @ts-ignore we don't want to redeclare all the method signatures
  override create(...args: Parameters<Transcriptions['create']>): ReturnType<Transcriptions['create']> {
    this._deployments.push(args[0].model);
    return super.create(args[0], args[1]);
  }
}

export class AzureAudio extends Audio {
  constructor(
    client: OpenAI,
    private _deployments: string[],
  ) {
    super(client);
  }
  // @ts-ignore we don't want to redeclare all the method signatures
  override translations: Audio.Translations = new AzureTranslation(this._client, this._deployments);
  // @ts-ignore we don't want to redeclare all the method signatures
  override transcriptions: Audio.Transcriptions = new AzureTranscription(this._client, this._deployments);
}
