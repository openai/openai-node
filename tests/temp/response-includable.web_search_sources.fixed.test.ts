import * as ResponsesAPI from 'openai/resources/responses/responses';
import { compareType } from '../utils/typing';

type IsAssignable = 'web_search_call.action.sources' extends ResponsesAPI.ResponseIncludable ? true : false;

test('[POST-FIX] ResponseIncludable includes web_search_call.action.sources', () => {
  // After the fix, this should type-check.
  compareType<IsAssignable, true>(true);
});
