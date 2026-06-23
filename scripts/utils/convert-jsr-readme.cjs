const fs = require('fs');
const { parse } = require('@typescript-eslint/parser');
const { TSError } = require('@typescript-eslint/typescript-estree');

/**
 * Quick and dirty AST traversal
 */
function traverse(node, visitor) {
  if (!node || typeof node.type !== 'string') return;
  visitor.node?.(node);
  visitor[node.type]?.(node);
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const elem of value) traverse(elem, visitor);
    } else if (value instanceof Object) {
      traverse(value, visitor);
    }
  }
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
  return content.replace(/process\.env(?:\.|\[['"])(.+?)(?:['"]\])/g, "Deno.env.get('$1')");
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
  try {
    const ast = parse(code, { sourceType: 'module', range: true });
    return replaceRanges(code, ({ replace }) =>
      traverse(ast, {
        node(node) {
          switch (node.type) {
            case 'ImportDeclaration':
            case 'ExportNamedDeclaration':
            case 'ExportAllDeclaration':
            case 'ImportExpression':
              if (node.source) {
                const { range, value } = node.source;
                if (value.startsWith(config.npm)) {
                  replace(range, JSON.stringify(value.replace(config.npm, config.jsr)));
                }
              }
          }
        },
      }),
    );
  } catch (e) {
    if (e instanceof TSError) {
      // This can error if the code block is not valid TS, in this case give up trying to transform the imports.
      console.warn(`Original codeblock could not be parsed, replace import skipped: ${e}\n\n${code}`);
      return code;
    }
    throw e;
  }
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
