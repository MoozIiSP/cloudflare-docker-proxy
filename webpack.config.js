const path = require("path");

module.exports = {
  context: path.resolve(__dirname, "./"),
  target: "webworker",
  mode: "production",
  optimization: {
    usedExports: true,
  },
  module: {
    rules: [
      {
        // 让 html 以“字符串”的形式被 import
        test: /\.html$/i,
        type: "asset/source",
      },
      {
        include: /node_modules/,
        test: /\.mjs$/,
        type: "javascript/auto",
      },
    ],
  },
};
