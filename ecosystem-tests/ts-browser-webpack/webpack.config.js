const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const publicPath = path.resolve(__dirname, 'public');
const srcPath = path.resolve(__dirname, 'src');
const buildPath = path.resolve(__dirname, 'dist');

module.exports = {
  entry: path.join(srcPath, 'index.ts'),

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
        loader: 'ts-loader',
      },
    ],
  },

  resolve: {
    extensions: ['*', '.js', '.ts'],
  },

  devtool: 'inline-source-map',

  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(publicPath, 'index.html'),
      filename: 'index.html',
    }),
  ],
};
