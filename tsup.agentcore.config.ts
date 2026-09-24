/**
 * tsup.agentcore.config.ts —— 只给 AgentCore 代码包用的打包配置。
 *
 * ## 为什么要单独一份
 *
 * 主 `tsup.config.ts` 走 npm 包的常规约定：把 `dependencies` 留作 external，
 * 由安装方的 node_modules 提供。那对 npm 发布是对的。
 *
 * 但 AgentCore 的代码包是一个 zip，里面**没有 node_modules**，
 * 所以 external 的依赖在运行时找不到。实测的报错就是这个：
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package
 *     '@modelcontextprotocol/sdk' imported from .../agentcore-http.js
 *
 * 官方文档给了两条路：vendored `node_modules/` 或 esbuild 打成单文件。
 * 这里选单文件 —— 少一个「装漏了什么」的失败面，包也小得多。
 *
 * ## 为什么不直接改主配置
 *
 * 改主配置会让 `dist/index.js` 与 `dist/stdio.js` 也把依赖打进去，
 * 而那两个是 npm 包的产物 —— 依赖会被装两次（一次在 bundle 里、
 * 一次在使用方的 node_modules 里），版本还可能不一致。
 */

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/agentcore-http.ts'],
  outDir: 'dist-agentcore',
  format: ['esm'],
  // AgentCore 的运行时是 NODE_22，可以直接用它的语言特性。
  target: 'node22',
  platform: 'node',
  // 关键：把所有依赖打进单文件。zip 里没有 node_modules。
  noExternal: [/.*/],
  // node: 前缀的内建模块不该被打包，它们由运行时提供。
  external: [/^node:/],
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  // 不压缩：报错栈要能读。省下的几十 KB 对 250MB 上限毫无意义。
  minify: false,
});
