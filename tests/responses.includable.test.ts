import * as ResponsesAPI from 'openai/resources/responses/responses';
import { compareType } from './utils/typing';

describe('ResponseIncludable long-term invariants', () => {
  test('includes web_search_call.action.sources', () => {
    type IsAssignable = 'web_search_call.action.sources' extends ResponsesAPI.ResponseIncludable ? true : false;
    compareType<IsAssignable, true>(true);
  });

  test('rejects arbitrary values', () => {
    type IsNotAssignable = 'not.a.real.include' extends ResponsesAPI.ResponseIncludable ? true : false;
    compareType<IsNotAssignable, false>(true);
  });
});

