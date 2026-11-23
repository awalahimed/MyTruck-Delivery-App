const fs = require("node:fs");
const path = require("node:path");
const babel = require("@babel/core");
const commonJsPlugin = require.resolve("@babel/plugin-transform-modules-commonjs");

function loadBabelModule(entryPath, mocks = {}) {
  const cache = new Map();

  function loadFile(filePath) {
    const absolutePath = path.resolve(filePath);
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
    const module = { exports: {} };
    cache.set(absolutePath, module);
    const source = fs.readFileSync(absolutePath, "utf8");
    const compiled = babel.transformSync(source, {
      filename: absolutePath,
      configFile: false,
      babelrc: false,
      plugins: [commonJsPlugin],
    }).code;

    function localRequire(request) {
      let resolvedPath;
      if (request.startsWith(".")) {
        resolvedPath = path.resolve(path.dirname(absolutePath), request);
        if (!path.extname(resolvedPath)) resolvedPath += ".js";
      }
      if (resolvedPath && Object.prototype.hasOwnProperty.call(mocks, resolvedPath)) return mocks[resolvedPath];
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      if (resolvedPath) return loadFile(resolvedPath);
      return require(request);
    }

    new Function("require", "module", "exports", "__filename", "__dirname", compiled)(
      localRequire,
      module,
      module.exports,
      absolutePath,
      path.dirname(absolutePath)
    );
    return module.exports;
  }

  return loadFile(entryPath);
}

module.exports = { loadBabelModule };
