import { defineConfig } from 'tsup';

export default defineConfig({
  // 两个入口：
  //   index.ts          纯库：工具表 + 分发（无顶层副作用）
  //   stdio.ts          stdio 传输（本地 / npx 用）
  //   agentcore-http.ts HTTP 传输（AgentCore Runtime 用，POST /mcp:8000）
  // 两者共用 index.ts 导出的 createConfiguredServer()，工具表只有一份。
  entry: ['src/index.ts', 'src/stdio.ts', 'src/agentcore-http.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: false,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
