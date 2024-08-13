import { ZodSchema, ZodTypeDef } from 'zod';
import { Refs, Seen } from './Refs';
import { JsonSchema7Type } from './parseDef';

export type Targets = 'jsonSchema7' | 'jsonSchema2019-09' | 'openApi3';

export type DateStrategy = 'format:date-time' | 'format:date' | 'string' | 'integer';

export const ignoreOverride = Symbol('Let zodToJsonSchema decide on which parser to use');

export type Options<Target extends Targets = 'jsonSchema7'> = {
  name: string | undefined;
  $refStrategy: 'root' | 'relative' | 'none' | 'seen' | 'extract-to-root';
  basePath: string[];
  effectStrategy: 'input' | 'any';
  pipeStrategy: 'input' | 'output' | 'all';
  dateStrategy: DateStrategy | DateStrategy[];
  mapStrategy: 'entries' | 'record';
  removeAdditionalStrategy: 'passthrough' | 'strict';
  nullableStrategy: 'from-target' | 'property';
  target: Target;
  strictUnions: boolean;
  definitionPath: string;
  definitions: Record<string, ZodSchema | ZodTypeDef>;
  errorMessages: boolean;
  markdownDescription: boolean;
  patternStrategy: 'escape' | 'preserve';
  applyRegexFlags: boolean;
  emailStrategy: 'format:email' | 'format:idn-email' | 'pattern:zod';
  base64Strategy: 'format:binary' | 'contentEncoding:base64' | 'pattern:zod';
  nameStrategy: 'ref' | 'duplicate-ref' | 'title';
  override?: (
    def: ZodTypeDef,
    refs: Refs,
    seen: Seen | undefined,
    forceResolution?: boolean,
  ) => JsonSchema7Type | undefined | typeof ignoreOverride;
  openaiStrictMode?: boolean;
};

export const getDefaultOptions = <Target extends Targets>(
  options: Partial<Options<Target>> | string | undefined,
) => {
  // Move the default options into the function to prevent the 'definitions' being mutated in each run
  const defaultOptions: Options = {
    name: undefined,
    $refStrategy: 'root',
    basePath: ['#'],
    effectStrategy: 'input',
    pipeStrategy: 'all',
    dateStrategy: 'format:date-time',
    mapStrategy: 'entries',
    nullableStrategy: 'from-target',
    removeAdditionalStrategy: 'passthrough',
    definitionPath: 'definitions',
    target: 'jsonSchema7',
    strictUnions: false,
    definitions: {},
    errorMessages: false,
    markdownDescription: false,
    patternStrategy: 'escape',
    applyRegexFlags: false,
    emailStrategy: 'format:email',
    base64Strategy: 'contentEncoding:base64',
    nameStrategy: 'ref',
  };
  return (
    typeof options === 'string' ?
      {
        ...defaultOptions,
        // Create a new object to avoid mutating the default options
        basePath: ['#'],
        definitions: {},
        name: options,
      }
    : {
        ...defaultOptions,
        basePath: ['#'],
        definitions: {},
        ...options,
      }) as Options<Target>;
};
