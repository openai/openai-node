import * as ResponsesAPI from 'openai/resources/responses/responses';

// Post-fix: park this repro by making it a no-op assertion that still
// references the type but does not expect a compile error anymore.

describe('ResponseIncludable repro (parked post-fix)', () => {
  test('documented include value now accepted', () => {
    const okNow: ResponsesAPI.ResponseIncludable = 'web_search_call.action.sources';
    void okNow;
    expect(true).toBe(true);
  });
});
