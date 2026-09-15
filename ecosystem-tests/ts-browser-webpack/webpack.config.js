const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const publicPath = path.resolve(__dirname, 'public');
const srcPath = path.resolve(__dirname, 'src');
const buildPath = path.resolve(__dirname, 'dist');

const verifyOpenAIEntrypoint = (entrypoint) => ({
  apply(compiler) {
    compiler.hooks.afterCompile.tap('VerifyOpenAIEntrypoint', (compilation) => {
      if (compilation.compiler !== compiler) {
        return;
      }

      const expectedPath = path.join(path.dirname(require.resolve('openai')), entrypoint);
      const includesEntrypoint = [...compilation.modules].some(({ resource }) => resource === expectedPath);

      if (!includesEntrypoint) {
        compilation.errors.push(new Error(`Expected webpack to bundle openai/${entrypoint}.`));
      }
    });
  },
});

const commonJSConfig = {
  name: 'commonjs',

  entry: path.join(srcPath, 'index.ts'),

  mode: 'development',

  output: {
    path: buildPath,
    filename: 'bundle.js',
  },

  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
      },
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: 'ts-loader',
      },
    ],
  },

  resolve: {
    extensions: ['.js', '.ts'],
  },

  devtool: 'eval',

  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(publicPath, 'index.html'),
      filename: 'index.html',
    }),
    verifyOpenAIEntrypoint('index.js'),
  ],

  devServer: {
    static: {
      directory: publicPath,
    },
    compress: true,
    port: 8080,
  },
};

const esmConfig = {
  ...commonJSConfig,

  name: 'esm',

  output: {
    ...commonJSConfig.output,
    filename: 'bundle.esm.js',
  },

  module: {
    ...commonJSConfig.module,
    rules: commonJSConfig.module.rules.map((rule) =>
      rule.use === 'ts-loader'
        ? {
            ...rule,
            use: {
              loader: 'ts-loader',
              options: {
                compilerOptions: {
                  module: 'esnext',
                  moduleResolution: 'node',
                },
              },
            },
          }
        : rule,
    ),
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(publicPath, 'index.html'),
      filename: 'index.esm.html',
    }),
    verifyOpenAIEntrypoint('index.mjs'),
  ],

  devServer: undefined,
};

module.exports = [commonJSConfig, esmConfig];
