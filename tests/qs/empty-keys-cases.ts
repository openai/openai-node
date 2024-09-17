export const empty_test_cases = [
  {
    input: '&',
    with_empty_keys: {},
    stringify_output: {
      brackets: '',
      indices: '',
      repeat: '',
    },
    no_empty_keys: {},
  },
  {
    input: '&&',
    with_empty_keys: {},
    stringify_output: {
      brackets: '',
      indices: '',
      repeat: '',
    },
    no_empty_keys: {},
  },
  {
    input: '&=',
    with_empty_keys: { '': '' },
    stringify_output: {
      brackets: '=',
      indices: '=',
      repeat: '=',
    },
    no_empty_keys: {},
  },
  {
    input: '&=&',
    with_empty_keys: { '': '' },
    stringify_output: {
      brackets: '=',
      indices: '=',
      repeat: '=',
    },
    no_empty_keys: {},
  },
  {
    input: '&=&=',
    with_empty_keys: { '': ['', ''] },
    stringify_output: {
      brackets: '[]=&[]=',
      indices: '[0]=&[1]=',
      repeat: '=&=',
    },
    no_empty_keys: {},
  },
  {
    input: '&=&=&',
    with_empty_keys: { '': ['', ''] },
    stringify_output: {
      brackets: '[]=&[]=',
      indices: '[0]=&[1]=',
      repeat: '=&=',
    },
    no_empty_keys: {},
  },
  {
    input: '=',
    with_empty_keys: { '': '' },
    no_empty_keys: {},
    stringify_output: {
      brackets: '=',
      indices: '=',
      repeat: '=',
    },
  },
  {
    input: '=&',
    with_empty_keys: { '': '' },
    stringify_output: {
      brackets: '=',
      indices: '=',
      repeat: '=',
    },
    no_empty_keys: {},
  },
  {
    input: '=&&&',
    with_empty_keys: { '': '' },
    stringify_output: {
      brackets: '=',
      indices: '=',
      repeat: '=',
    },
    no_empty_keys: {},
  },
  {
    input: '=&=&=&',
    with_empty_keys: { '': ['', '', ''] },
    stringify_output: {
      brackets: '[]=&[]=&[]=',
      indices: '[0]=&[1]=&[2]=',
      repeat: '=&=&=',
    },
    no_empty_keys: {},
  },
  {
    input: '=&a[]=b&a[1]=c',
    with_empty_keys: { '': '', a: ['b', 'c'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c',
      indices: '=&a[0]=b&a[1]=c',
      repeat: '=&a=b&a=c',
    },
    no_empty_keys: { a: ['b', 'c'] },
  },
  {
    input: '=a',
    with_empty_keys: { '': 'a' },
    no_empty_keys: {},
    stringify_output: {
      brackets: '=a',
      indices: '=a',
      repeat: '=a',
    },
  },
  {
    input: 'a==a',
    with_empty_keys: { a: '=a' },
    no_empty_keys: { a: '=a' },
    stringify_output: {
      brackets: 'a==a',
      indices: 'a==a',
      repeat: 'a==a',
    },
  },
  {
    input: '=&a[]=b',
    with_empty_keys: { '': '', a: ['b'] },
    stringify_output: {
      brackets: '=&a[]=b',
      indices: '=&a[0]=b',
      repeat: '=&a=b',
    },
    no_empty_keys: { a: ['b'] },
  },
  {
    input: '=&a[]=b&a[]=c&a[2]=d',
    with_empty_keys: { '': '', a: ['b', 'c', 'd'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c&a[]=d',
      indices: '=&a[0]=b&a[1]=c&a[2]=d',
      repeat: '=&a=b&a=c&a=d',
    },
    no_empty_keys: { a: ['b', 'c', 'd'] },
  },
  {
    input: '=a&=b',
    with_empty_keys: { '': ['a', 'b'] },
    stringify_output: {
      brackets: '[]=a&[]=b',
      indices: '[0]=a&[1]=b',
      repeat: '=a&=b',
    },
    no_empty_keys: {},
  },
  {
    input: '=a&foo=b',
    with_empty_keys: { '': 'a', foo: 'b' },
    no_empty_keys: { foo: 'b' },
    stringify_output: {
      brackets: '=a&foo=b',
      indices: '=a&foo=b',
      repeat: '=a&foo=b',
    },
  },
  {
    input: 'a[]=b&a=c&=',
    with_empty_keys: { '': '', a: ['b', 'c'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c',
      indices: '=&a[0]=b&a[1]=c',
      repeat: '=&a=b&a=c',
    },
    no_empty_keys: { a: ['b', 'c'] },
  },
  {
    input: 'a[]=b&a=c&=',
    with_empty_keys: { '': '', a: ['b', 'c'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c',
      indices: '=&a[0]=b&a[1]=c',
      repeat: '=&a=b&a=c',
    },
    no_empty_keys: { a: ['b', 'c'] },
  },
  {
    input: 'a[0]=b&a=c&=',
    with_empty_keys: { '': '', a: ['b', 'c'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c',
      indices: '=&a[0]=b&a[1]=c',
      repeat: '=&a=b&a=c',
    },
    no_empty_keys: { a: ['b', 'c'] },
  },
  {
    input: 'a=b&a[]=c&=',
    with_empty_keys: { '': '', a: ['b', 'c'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c',
      indices: '=&a[0]=b&a[1]=c',
      repeat: '=&a=b&a=c',
    },
    no_empty_keys: { a: ['b', 'c'] },
  },
  {
    input: 'a=b&a[0]=c&=',
    with_empty_keys: { '': '', a: ['b', 'c'] },
    stringify_output: {
      brackets: '=&a[]=b&a[]=c',
      indices: '=&a[0]=b&a[1]=c',
      repeat: '=&a=b&a=c',
    },
    no_empty_keys: { a: ['b', 'c'] },
  },
  {
    input: '[]=a&[]=b& []=1',
    with_empty_keys: { '': ['a', 'b'], ' ': ['1'] },
    stringify_output: {
      brackets: '[]=a&[]=b& []=1',
      indices: '[0]=a&[1]=b& [0]=1',
      repeat: '=a&=b& =1',
    },
    no_empty_keys: { 0: 'a', 1: 'b', ' ': ['1'] },
  },
  {
    input: '[0]=a&[1]=b&a[0]=1&a[1]=2',
    with_empty_keys: { '': ['a', 'b'], a: ['1', '2'] },
    no_empty_keys: { 0: 'a', 1: 'b', a: ['1', '2'] },
    stringify_output: {
      brackets: '[]=a&[]=b&a[]=1&a[]=2',
      indices: '[0]=a&[1]=b&a[0]=1&a[1]=2',
      repeat: '=a&=b&a=1&a=2',
    },
  },
  {
    input: '[deep]=a&[deep]=2',
    with_empty_keys: { '': { deep: ['a', '2'] } },
    stringify_output: {
      brackets: '[deep][]=a&[deep][]=2',
      indices: '[deep][0]=a&[deep][1]=2',
      repeat: '[deep]=a&[deep]=2',
    },
    no_empty_keys: { deep: ['a', '2'] },
  },
  {
    input: '%5B0%5D=a&%5B1%5D=b',
    with_empty_keys: { '': ['a', 'b'] },
    stringify_output: {
      brackets: '[]=a&[]=b',
      indices: '[0]=a&[1]=b',
      repeat: '=a&=b',
    },
    no_empty_keys: { 0: 'a', 1: 'b' },
  },
] satisfies {
  input: string;
  with_empty_keys: Record<string, unknown>;
  stringify_output: {
    brackets: string;
    indices: string;
    repeat: string;
  };
  no_empty_keys: Record<string, unknown>;
}[];
