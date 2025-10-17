import { APIPromise } from 'openai/core/api-promise';
import { AbstractPage, Page } from 'openai/core/pagination';
import { Stream } from 'openai/core/streaming';

const dummyResponseProps: any = { response: new Response(), options: {} };
const dummyParse = (_client: any, _props: any) => ({ data: null, response: new Response() });

describe('core brand-guard stability', () => {
  test('APIPromise.then with mismatched this does not throw private-field TypeError', async () => {
    const fake: any = Object.create(APIPromise.prototype);
    fake.responsePromise = Promise.resolve(dummyResponseProps);
    fake.parseResponse = dummyParse;

    const call = () => (APIPromise.prototype.then as any).call(fake, () => {});
    expect(call).toThrow(Error);
    expect(call).not.toThrow(/private member/i);
  });

  test('APIPromise.catch with mismatched this does not throw private-field TypeError', async () => {
    const fake: any = Object.create(APIPromise.prototype);
    fake.responsePromise = Promise.resolve(dummyResponseProps);
    fake.parseResponse = dummyParse;

    const call = () => (APIPromise.prototype.catch as any).call(fake, () => {});
    expect(call).toThrow(Error);
    expect(call).not.toThrow(/private member/i);
  });

  test('APIPromise.finally with mismatched this does not throw private-field TypeError', async () => {
    const fake: any = Object.create(APIPromise.prototype);
    fake.responsePromise = Promise.resolve(dummyResponseProps);
    fake.parseResponse = dummyParse;

    const call = () => (APIPromise.prototype.finally as any).call(fake, () => {});
    expect(call).toThrow(Error);
    expect(call).not.toThrow(/private member/i);
  });

  test('AbstractPage.getNextPage with mismatched this does not throw private-field TypeError', async () => {
    class TestPage<Item> extends Page<Item> {
      override nextPageRequestOptions() {
        return { path: '/v1/anything', method: 'get' } as any;
      }
    }

    const fake: any = Object.create(TestPage.prototype);
    fake.options = { path: '/v1/anything', method: 'get' };
    fake.getPaginatedItems = () => [1];
    fake.response = new Response();
    fake.body = {};

    const call = () => (AbstractPage.prototype.getNextPage as any).call(fake);
    await expect(call()).rejects.toBeInstanceOf(Error);
    await expect(call()).rejects.not.toThrow(/private member/i);
  });

  test('Stream.tee with mismatched this does not throw private-field TypeError', () => {
    const fake: any = Object.create(Stream.prototype);
    fake.controller = new AbortController();
    fake.iterator = async function* () {};

    const call = () => (Stream.prototype.tee as any).call(fake);
    expect(call).not.toThrow(/private member/i);
  });
});
