import { OpenAIError } from '../../core/error';

/**
 * Percent-encode everything that isn't safe to have in a path without encoding safe chars.
 *
 * Taken from https://datatracker.ietf.org/doc/html/rfc3986#section-3.3:
 * > unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
 * > sub-delims  = "!" / "$" / "&" / "'" / "(" / ")" / "*" / "+" / "," / ";" / "="
 * > pchar       = unreserved / pct-encoded / sub-delims / ":" / "@"
 */
export function encodeURIPath(str: string) {
  return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}

export const createPathTagFunction = (pathEncoder = encodeURIPath) =>
  function path(statics: readonly string[], ...params: readonly unknown[]): string {
    // If there are no params, no processing is needed.
    if (statics.length === 1) return statics[0]!;

    let postPath = false;
    const path = statics.reduce((previousValue, currentValue, index) => {
      if (/[?#]/.test(currentValue)) {
        postPath = true;
      }
      return (
        previousValue +
        currentValue +
        (index === params.length ? '' : (postPath ? encodeURIComponent : pathEncoder)(String(params[index])))
      );
    }, '');

    const pathOnly = path.split(/[?#]/, 1)[0]!;
    const invalidSegments = [];
    const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
    let match;

    // Find all invalid segments
    while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
      invalidSegments.push({
        start: match.index,
        length: match[0].length,
      });
    }

    if (invalidSegments.length > 0) {
      let lastEnd = 0;
      const underline = invalidSegments.reduce((acc, segment) => {
        const spaces = ' '.repeat(segment.start - lastEnd);
        const arrows = '^'.repeat(segment.length);
        lastEnd = segment.start + segment.length;
        return acc + spaces + arrows;
      }, '');

      throw new OpenAIError(`Path parameters result in path with invalid segments:\n${path}\n${underline}`);
    }

    return path;
  };

/**
 * URI-encodes path params and ensures no unsafe /./ or /../ path segments are introduced.
 */
export const path = createPathTagFunction(encodeURIPath);
