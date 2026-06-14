const fs = require('fs');
const ts = require('typescript');

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function getModuleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0
  ) {
    return node.arguments[0];
  }

  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return node.argument.literal;
  }

  return null;
}

function replacePackageSpecifier(value, config) {
  if (value === config.npm) {
    return config.jsr;
  }

  if (value.startsWith(`${config.npm}/`)) {
    return `${config.jsr}${value.slice(config.npm.length)}`;
  }

  return null;
}

/**
 * Helper method for replacing arbitrary ranges of text in input code.
 */
function replaceRanges(code, replacer) {
  const replacements = [];
  replacer({ replace: (range, replacement) => replacements.push({ range, replacement }) });

  if (!replacements.length) return code;
  replacements.sort((a, b) => a.range[0] - b.range[0]);
  const overlapIndex = replacements.findIndex(
    (r, index) => index > 0 && replacements[index - 1].range[1] > r.range[0],
  );
  if (overlapIndex >= 0) {
    throw new Error(
      `replacements overlap: ${JSON.stringify(replacements[overlapIndex - 1])} and ${JSON.stringify(
        replacements[overlapIndex],
      )}`,
    );
  }

  const parts = [];
  let end = 0;
  for (const {
    range: [from, to],
    replacement,
  } of replacements) {
    if (from > end) parts.push(code.substring(end, from));
    parts.push(replacement);
    end = to;
  }
  if (end < code.length) parts.push(code.substring(end));
  return parts.join('');
}

function replaceProcessEnv(content) {
  // Replace process.env['KEY'] and process.env.KEY with Deno.env.get('KEY')
  return content
    .replace(/process\.env\[['"]([^'"]+)['"]\]/g, "Deno.env.get('$1')")
    .replace(/process\.env\.([A-Za-z_$][\w$]*)/g, "Deno.env.get('$1')");
}

function replaceProcessStdout(content) {
  return content.replace(/process\.stdout.write\(([^)]+)\)/g, 'Deno.stdout.writeSync($1)');
}

function replaceInstallationDirections(content) {
  // Remove npm installation section
  return content.replace(/```sh\nnpm install.*?\n```.*### Installation from JSR\n\n/s, '');
}

/**
 * Maps over module paths in imports and exports
 */
function replaceImports(code, config) {
  const sourceFile = ts.createSourceFile(
    'readme-code-block.ts',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostics = sourceFile.parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n');
    // This can error if the code block is not valid TS, in this case give up trying to transform the imports.
    console.warn(`Original codeblock could not be parsed, replace import skipped: ${diagnostics}\n\n${code}`);
    return code;
  }

  return replaceRanges(code, ({ replace }) => {
    function visit(node) {
      const moduleSpecifier = getModuleSpecifier(node);

      if (moduleSpecifier && isStringLiteralLike(moduleSpecifier)) {
        const replacement = replacePackageSpecifier(moduleSpecifier.text, config);
        if (replacement) {
          replace(
            [moduleSpecifier.getStart(sourceFile), moduleSpecifier.getEnd()],
            JSON.stringify(replacement),
          );
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  });
}

function processReadme(config, file) {
  try {
    let readmeContent = fs.readFileSync(file, 'utf8');

    // First replace installation directions
    readmeContent = replaceInstallationDirections(readmeContent);

    // Replace content in all code blocks with a single regex
    readmeContent = readmeContent.replaceAll(
      /```(?:typescript|ts|javascript|js)\n([\s\S]*?)```/g,
      (match, codeBlock) => {
        try {
          let transformedCode = codeBlock.trim();
          transformedCode = replaceImports(transformedCode, config);
          transformedCode = replaceProcessEnv(transformedCode);
          transformedCode = replaceProcessStdout(transformedCode);
          return '```typescript\n' + transformedCode + '\n```';
        } catch (error) {
          console.warn(`Failed to transform code block: ${error}\n\n${codeBlock}`);
          return match; // Return original code block if transformation fails
        }
      },
    );

    fs.writeFileSync(file, readmeContent);
  } catch (error) {
    console.error('Error processing README:', error);
    throw error;
  }
}

const config = {
  npm: 'openai',
  jsr: '@openai/openai',
};

processReadme(config, process.argv[2]);
