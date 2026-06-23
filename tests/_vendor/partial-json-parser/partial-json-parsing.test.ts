import fc from 'fast-check';
import { MalformedJSON, partialParse } from 'openai/_vendor/partial-json-parser/parser';

describe('partial parsing', () => {
  test('should parse complete json', () => {
    expect(partialParse('{"__proto__": 0}')).toEqual(JSON.parse('{"__proto__": 0}'));

    fc.assert(
      fc.property(fc.json({ depthSize: 'large', noUnicodeString: false }), (jsonString) => {
        const parsedNormal = JSON.parse(jsonString);
        const parsedPartial = partialParse(jsonString);
        expect(parsedPartial).toEqual(parsedNormal);
      }),
    );
  });

  test('should parse partial json', () => {
    expect(partialParse('{"field')).toEqual({});
    expect(partialParse('"')).toEqual('');
    expect(partialParse('[2, 3, 4')).toEqual([2, 3]);
    expect(partialParse('{"field": true, "field2')).toEqual({ field: true });
    expect(partialParse('{"field": true, "field2":')).toEqual({ field: true });
    expect(partialParse('{"field": true, "field2":{')).toEqual({ field: true, field2: {} });
    expect(partialParse('{"field": true, "field2": { "obj": "somestr')).toEqual({
      field: true,
      field2: { obj: 'somestr' },
    });
    expect(partialParse('{"field": true, "field2": { "obj": "somestr",')).toEqual({
      field: true,
      field2: { obj: 'somestr' },
    });
    expect(partialParse('{"field": "va')).toEqual({ field: 'va' });
    expect(partialParse('[ "v1", 2, "v2", 3')).toEqual(['v1', 2, 'v2']);
    expect(partialParse('[ "v1", 2, "v2", -')).toEqual(['v1', 2, 'v2']);
    expect(partialParse('[1, 2e')).toEqual([1]);
  });

  test('should only throw errors parsing numbers', () =>
    fc.assert(
      fc.property(fc.json({ depthSize: 'large', noUnicodeString: false }), (jsonString) => {
        for (let i = 1; i < jsonString.length; i++) {
          // speedup
          i += Math.floor(Math.random() * 3);
          const substring = jsonString.substring(0, i);

          // since we don't allow partial parsing for numbers
          if (
            typeof JSON.parse(jsonString) === 'number' &&
            'e-+.'.includes(substring[substring.length - 1]!)
          ) {
            expect(() => partialParse(substring)).toThrow(MalformedJSON);
          } else {
            partialParse(substring);
          }
        }
      }),
    ));
});
