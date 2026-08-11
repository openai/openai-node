import { createRequire } from 'node:module';

import ts from 'typescript';

const requireCoverageModule = createRequire(`${process.cwd()}/package.json`);

interface TypeMapper {
  sources?: ts.Type[];
  targets?: (ts.Type | (() => ts.Type))[];
  source?: ts.Type;
  target?: ts.Type;
  mapper1?: TypeMapper;
  mapper2?: TypeMapper;
}

interface InheritedTypeArgument {
  type: ts.Type;
  mapper?: TypeMapper;
}

const syntax = requireCoverageModule('./scripts/jsdoc-coverage-syntax.cjs') as {
  canonicalName: (node: ts.Node) => string;
  hasCommentText: (comment: string | (string | { text: string })[] | undefined) => boolean;
  hasNodeDocumentation: (node: ts.Node) => boolean;
  isInternal: (node: ts.Node) => boolean;
  isVisibleMember: (node: ts.Node) => boolean;
  memberName: (node: ts.Node, sourceFile: ts.SourceFile) => string;
  positionalBranch: (parent: ts.Node, child: ts.Node) => string | undefined;
};

const typeSystem = requireCoverageModule('./scripts/jsdoc-coverage-type-system.cjs') as {
  externalTypeArguments: (
    checker: ts.TypeChecker,
    type: ts.Type,
    handwrittenFiles: Map<string, boolean>,
  ) => InheritedTypeArgument[];
  instantiateMappedType: (type: ts.Type, mapper?: TypeMapper) => ts.Type;
};

function parsedSource(source: string): ts.SourceFile {
  return ts.createSourceFile('/jsdoc-coverage-unit.ts', source, ts.ScriptTarget.ES2022, true);
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('The in-memory TypeScript fixture is incomplete.');
  }
  return value;
}

function typedSource(source: string): { checker: ts.TypeChecker; sourceFile: ts.SourceFile } {
  const file = '/jsdoc-coverage-unit.ts';
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es5.d.ts'],
    noResolve: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === file
      ? ts.createSourceFile(file, source, languageVersion, true)
      : original(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([file], options, host);
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) {
    throw new Error('Could not create the in-memory TypeScript fixture.');
  }
  return { checker: program.getTypeChecker(), sourceFile };
}

function namedType(checker: ts.TypeChecker, sourceFile: ts.SourceFile, name: string): ts.Type {
  const alias = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  if (!alias) {
    throw new Error(`Missing in-memory type alias ${name}.`);
  }
  return checker.getTypeAtLocation(alias.type);
}

describe('JSDoc coverage syntax helpers', () => {
  test('distinguishes useful documentation from empty and internal-only comments', () => {
    const sourceFile = parsedSource(`
      interface Example {
        /** Useful explanation. */
        visible: string;
        /** @internal */
        hidden: string;
        /** */
        empty: string;
      }
    `);
    const declaration = sourceFile.statements[0] as ts.InterfaceDeclaration;
    const [visible, hidden, empty] = declaration.members;

    expect(syntax.hasCommentText(' explanation ')).toBe(true);
    expect(syntax.hasCommentText([{ text: '  ' }, { text: 'useful' }])).toBe(true);
    expect(syntax.hasCommentText('  ')).toBe(false);
    expect(syntax.hasNodeDocumentation(required(visible))).toBe(true);
    expect(syntax.isInternal(required(hidden))).toBe(true);
    expect(syntax.hasNodeDocumentation(required(hidden))).toBe(false);
    expect(syntax.hasNodeDocumentation(required(empty))).toBe(false);
  });

  test('excludes private, protected, internal, and private-identifier members', () => {
    const sourceFile = parsedSource(`
      class Example {
        visible = true;
        private hidden = true;
        protected inherited = true;
        #secret = true;
        /** @internal */
        implementation = true;
      }
    `);
    const declaration = sourceFile.statements[0] as ts.ClassDeclaration;

    expect(declaration.members.map(syntax.isVisibleMember)).toEqual([true, false, false, false, false]);
  });

  test('provides canonical namespace, index, call, construct, and constructor names', () => {
    const sourceFile = parsedSource(`
      namespace Outer {
        export interface Shape {
          [key: string]: unknown;
          (value: string): unknown;
          new (value: string): Shape;
        }
        export class Client {
          constructor() {}
        }
      }
    `);
    const namespace = sourceFile.statements[0] as ts.ModuleDeclaration;
    const { statements } = namespace.body as ts.ModuleBlock;
    const shape = statements[0] as ts.InterfaceDeclaration;
    const client = statements[1] as ts.ClassDeclaration;

    expect(syntax.canonicalName(shape)).toBe('Outer.Shape');
    expect(shape.members.map((member) => syntax.memberName(member, sourceFile))).toEqual([
      '[key: string]',
      '[call]',
      '[new]',
    ]);
    expect(syntax.memberName(required(client.members[0]), sourceFile)).toBe('constructor');
  });

  test('separates generic constraints/defaults and callable intersections without splitting objects', () => {
    const sourceFile = parsedSource(`
      type Generic<Value extends { shared: string } = { shared: string }> = Value;
      type Callable = (() => void) & (() => void);
      type ObjectShape = { shared: string } & { shared: string };
    `);
    const generic = sourceFile.statements[0] as ts.TypeAliasDeclaration;
    const parameter = required(generic.typeParameters?.[0]);
    const callable = (sourceFile.statements[1] as ts.TypeAliasDeclaration).type as ts.IntersectionTypeNode;
    const object = (sourceFile.statements[2] as ts.TypeAliasDeclaration).type as ts.IntersectionTypeNode;

    expect(syntax.positionalBranch(parameter, required(parameter.constraint))).not.toEqual(
      syntax.positionalBranch(parameter, required(parameter.default)),
    );
    expect(syntax.positionalBranch(callable, required(callable.types[0]))).not.toEqual(
      syntax.positionalBranch(callable, required(callable.types[1])),
    );
    expect(syntax.positionalBranch(object, required(object.types[0]))).toBeUndefined();
    expect(syntax.positionalBranch(object, required(object.types[1]))).toBeUndefined();
  });
});

describe('JSDoc coverage type-system helpers', () => {
  test('composes compiler type-parameter substitutions without changing unrelated types', () => {
    const { checker, sourceFile } = typedSource(`
      type First = string;
      type Second = number;
      type Third = boolean;
    `);
    const first = namedType(checker, sourceFile, 'First');
    const second = namedType(checker, sourceFile, 'Second');
    const third = namedType(checker, sourceFile, 'Third');
    const mapper: TypeMapper = {
      mapper1: { sources: [first], targets: [second] },
      mapper2: { source: second, target: third },
    };

    expect(typeSystem.instantiateMappedType(first, mapper)).toBe(third);
    expect(typeSystem.instantiateMappedType(third, mapper)).toBe(third);
  });

  test('does not expose a phantom generic inherited through a handwritten base', () => {
    const { checker, sourceFile } = typedSource(`
      interface Base<Value> {
        id: string;
      }
      interface Wrapper<Value> extends Base<Value> {
        tag: string;
      }
      type Public = Wrapper<{ missing: string }>;
    `);
    const type = namedType(checker, sourceFile, 'Public');

    expect(typeSystem.externalTypeArguments(checker, type, new Map([[sourceFile.fileName, true]]))).toEqual(
      [],
    );
  });

  test('preserves transformed inherited payloads and composes their original mapper', () => {
    const { checker, sourceFile } = typedSource(`
      type Base<Value> = Promise<{ wrapped: Value }>;
      interface Wrapper<Value> extends Base<Value> {
        id: string;
      }
      type Public = Wrapper<{ missing: string }>;
    `);
    const type = namedType(checker, sourceFile, 'Public');
    const inherited = required(
      typeSystem.externalTypeArguments(checker, type, new Map([[sourceFile.fileName, true]]))[0],
    );
    const property = required(checker.getPropertiesOfType(inherited.type)[0]);
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) {
      throw new Error('The inherited payload is missing its wrapped property declaration.');
    }
    const uninstantiated = checker.getTypeOfSymbolAtLocation(property, declaration);
    const instantiated = typeSystem.instantiateMappedType(uninstantiated, inherited.mapper);

    expect(property.getName()).toBe('wrapped');
    expect(checker.getPropertiesOfType(instantiated).map((member) => member.getName())).toEqual(['missing']);
  });

  test('retains event maps used by visible inherited listener signatures', () => {
    const { checker, sourceFile } = typedSource(`
      interface Emitter<Events> {
        on<Event extends keyof Events>(event: Event, listener: (value: Events[Event]) => void): this;
      }
      interface Wrapper<Events> extends Emitter<Events> {
        tag: string;
      }
      type Public = Wrapper<{ message: { missing: string } }>;
    `);
    const type = namedType(checker, sourceFile, 'Public');
    const inherited = required(
      typeSystem.externalTypeArguments(checker, type, new Map([[sourceFile.fileName, true]]))[0],
    );
    const instantiated = typeSystem.instantiateMappedType(inherited.type, inherited.mapper);

    expect(checker.getPropertiesOfType(instantiated).map((member) => member.getName())).toEqual(['message']);
  });

  test('retains generic substitutions through inherited array payloads', () => {
    const { checker, sourceFile } = typedSource(`
      type Base<Value> = Promise<Value[]>;
      interface Wrapper<Value> extends Base<Value> {
        id: string;
      }
      type Public = Wrapper<{ missing: string }>;
    `);
    const type = namedType(checker, sourceFile, 'Public');
    const inherited = required(
      typeSystem.externalTypeArguments(checker, type, new Map([[sourceFile.fileName, true]]))[0],
    );
    const index = required(checker.getIndexInfosOfType(inherited.type)[0]);
    const instantiated = typeSystem.instantiateMappedType(index.type, inherited.mapper);

    expect(checker.getPropertiesOfType(instantiated).map((member) => member.getName())).toEqual(['missing']);
  });

  test('keeps the compiler compatibility facade aligned with independently testable modules', () => {
    const compiler = requireCoverageModule('./scripts/jsdoc-coverage-compiler.cjs') as Record<
      string,
      unknown
    >;

    expect(compiler['hasNodeDocumentation']).toBe(syntax.hasNodeDocumentation);
    expect(compiler['positionalBranch']).toBe(syntax.positionalBranch);
    expect(compiler['externalTypeArguments']).toBe(typeSystem.externalTypeArguments);
    expect(compiler['instantiateMappedType']).toBe(typeSystem.instantiateMappedType);
  });
});
