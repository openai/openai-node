import { OpenAIError } from '../../core/error';

/**
 * Percent-encodes a single URI path parameter while preserving RFC 3986 path characters.
 *
 * Slash, question-mark, and hash characters are encoded so an interpolated value
 * cannot create another path segment, query string, or fragment.
 *
 * Taken from https://datatracker.ietf.org/doc/html/rfc3986#section-3.3:
 * > unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
 * > sub-delims  = "!" / "$" / "&" / "'" / "(" / ")" / "*" / "+" / "," / ";" / "="
 * > pchar       = unreserved / pct-encoded / sub-delims / ":" / "@"
 */
export function encodeURIPath(str: string) {
  return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}

const EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));

/**
 * Creates a template tag that safely interpolates SDK resource paths.
 *
 * Path values use the supplied encoder; values after a literal `?` or `#` use
 * `encodeURIComponent`. Nullish values, ordinary objects, and literal or
 * percent-encoded `.`/`..` path segments are rejected with an SDK error.
 */
export const createPathTagFunction = (pathEncoder = encodeURIPath) =>
  function path(statics: readonly string[], ...params: readonly unknown[]): string {
    // If there are no params, no processing is needed.
    if (statics.length === 1) {
      return statics[0]!;
    }

    let postPath = false;
    const invalidSegments = [];
    let path = '';
    for (let index = 0; index < statics.length; index += 1) {
      if (index in statics) {
        const currentValue = statics[index]!;
        if (/[?#]/.test(currentValue)) {
          postPath = true;
        }
        const value = params[index];
        let encoded = (postPath ? encodeURIComponent : pathEncoder)('' + value);
        if (
          index !== params.length &&
          (value == null ||
            (typeof value === 'object' &&
              // handle values from other realms
              value.toString ===
                Object.getPrototypeOf(Object.getPrototypeOf((value as any).hasOwnProperty ?? EMPTY) ?? EMPTY)
                  ?.toString))
        ) {
          encoded = value + '';
          invalidSegments.push({
            start: path.length + currentValue.length,
            length: encoded.length,
            error: `Value of type ${Object.prototype.toString
              .call(value)
              .slice(8, -1)} is not a valid path parameter`,
          });
        }
        path += currentValue + (index === params.length ? '' : encoded);
      }
    }

    const pathOnly = path.split(/[?#]/, 1)[0]!;
    const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
    let match;

    // Find all invalid segments
    while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
      invalidSegments.push({
        start: match.index,
        length: match[0].length,
        error: `Value "${match[0]}" can't be safely passed as a path parameter`,
      });
    }

    invalidSegments.sort((a, b) => a.start - b.start);

    if (invalidSegments.length > 0) {
      let lastEnd = 0;
      let underline = '';
      for (const segment of invalidSegments) {
        const spaces = ' '.repeat(segment.start - lastEnd);
        const arrows = '^'.repeat(segment.length);
        lastEnd = segment.start + segment.length;
        underline += spaces + arrows;
      }

      throw new OpenAIError(
        `Path parameters result in path with invalid segments:\n${invalidSegments
          .map((e) => e.error)
          .join('\n')}\n${path}\n${underline}`,
      );
    }

    return path;
  };

/**
 * Template tag that encodes resource-path parameters and rejects traversal segments.
 *
 * Values inside query strings and fragments are encoded as URI components.
 */
export const path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);
