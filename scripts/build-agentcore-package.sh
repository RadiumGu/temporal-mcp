#!/usr/bin/env bash
#
# build-agentcore-package.sh —— 打 AgentCore「直接代码部署」用的 zip。
#
# ## 为什么要有这个脚本
#
# 手工分步打包会半途而废，已经踩过一次：`tsup.agentcore.config.ts` 里
# `clean: true`，重新构建时会把 dist-agentcore/ 整个清掉。手工流程里
# 「重新 build」之后忘了「重新写 package.json + 重新 zip」，
# 于是 aws s3 cp 报 path does not exist。
#
# 一条命令做完全部四步，就不会只做一半。
#
# ## AgentCore 的包约束（官方文档，实测过）
#
#   - 只支持 arm64（本包纯 JS，与架构无关：.node 引用数 0）
#   - zip 上限 250MB（本包约 0.7MB）
#   - 非可执行文件要 644，目录 755
#   - entryPoint 是 .js 的相对路径，没有 node 前缀
#   - 依赖要么 vendored node_modules/，要么打成单文件（本脚本选后者）
#
# ## 为什么要放 package.json
#
# bundle 是 ESM。`.js` 在没有 `{"type":"module"}` 时，Node 的模块类型
# 判定要靠向上层目录找 package.json，或靠 Node 22 的 ESM 语法探测 ——
# 后者依赖**次版本**，而 AgentCore 跑哪个次版本未知。
# 放一个 23 字节的 package.json 就把这个不确定性消掉了。

set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="dist-agentcore"
ZIP="$OUT_DIR/temporal-mcp.zip"

echo "① 打自包含 bundle（依赖全部打进去 —— zip 里没有 node_modules）"
npx tsup --config tsup.agentcore.config.ts

echo "② 写 package.json（声明 ESM，不依赖 Node 的语法探测）"
printf '{\n  "type": "module"\n}\n' > "$OUT_DIR/package.json"

echo "③ 修权限（文档要求非可执行文件 644）"
chmod 644 "$OUT_DIR/agentcore-http.js" "$OUT_DIR/package.json"

echo "④ 打 zip"
rm -f "$ZIP"
( cd "$OUT_DIR" && zip -q temporal-mcp.zip agentcore-http.js package.json )

echo
echo "包内容："
unzip -l "$ZIP" | sed 's/^/  /'

# 守卫：确认原生模块数为 0。有原生模块就必须为 arm64 编译，
# 而本机是什么架构不一定与 AgentCore 一致。
native=$(grep -c "\.node'" "$OUT_DIR/agentcore-http.js" || true)
echo "  原生模块引用数: ${native:-0}"
if [ "${native:-0}" != "0" ]; then
  echo "  ⚠️ 含原生模块 —— AgentCore 只支持 arm64，必须确认交叉编译" >&2
  exit 1
fi

echo
echo "下一步："
echo "  aws s3 cp $ZIP \\"
echo "    s3://dr-korea-agentcore-\$(aws sts get-caller-identity --query Account --output text)-ap-northeast-2/temporal-mcp/temporal-mcp.zip \\"
echo "    --region ap-northeast-2"
