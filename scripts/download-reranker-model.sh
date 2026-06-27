#!/usr/bin/env bash
# 下载本地 cross-encoder 重排序模型（onnx-community/bge-reranker-v2-m3-ONNX）
# 模型大小：~544MB（quantized ONNX）
# 下载后运行 npm run dev，自动加载；无模型时自动回退 DeepSeek API

set -euo pipefail

MODEL_DIR="models/onnx-community/bge-reranker-v2-m3-ONNX"
BASE_URL="${HF_ENDPOINT:-https://hf-mirror.com}/onnx-community/bge-reranker-v2-m3-ONNX/resolve/main"

echo "=== 下载 cross-encoder 模型 ==="
echo "镜像源: ${HF_ENDPOINT:-https://hf-mirror.com}"
echo "目标目录: $MODEL_DIR"
echo ""

mkdir -p "$MODEL_DIR/onnx"

# 配置文件
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  if [ ! -f "$MODEL_DIR/$f" ]; then
    echo "下载 $f..."
    curl -sL -o "$MODEL_DIR/$f" "$BASE_URL/$f"
  else
    echo "跳过 $f（已存在）"
  fi
done

# ONNX 模型文件
if [ ! -f "$MODEL_DIR/onnx/model.onnx" ]; then
  echo "下载 model.onnx（~544MB，可能需要几分钟）..."
  curl -L -o "$MODEL_DIR/onnx/model.onnx" "$BASE_URL/onnx/model_quantized.onnx"
else
  echo "跳过 onnx/model.onnx（已存在）"
fi

echo ""
echo "=== 完成 ==="
ls -lh "$MODEL_DIR/onnx/" "$MODEL_DIR/"*.json
