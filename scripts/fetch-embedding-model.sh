#!/bin/sh
# D-427 / ADR-0013: downloads multilingual-e5-small (int8 ONNX + tokenizer) for content search by meaning into a
# directory the API and worker load from (`FILE_SEARCH_MODEL_DIR`). Used by the Dockerfile's `model` stage.
#   fetch-embedding-model.sh <hf-repo> <revision> <out-dir> [onnx-sha256]
set -eu
REPO="$1"; REV="$2"; OUT="$3"; SHA="${4:-}"
BASE="https://huggingface.co/${REPO}/resolve/${REV}"
mkdir -p "$OUT/onnx"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  curl -fsSL --retry 3 -o "$OUT/$f" "$BASE/$f"
done
curl -fsSL --retry 3 -o "$OUT/onnx/model_quantized.onnx" "$BASE/onnx/model_quantized.onnx"
if [ -n "$SHA" ]; then
  echo "$SHA  $OUT/onnx/model_quantized.onnx" | sha256sum -c -
fi
ls -l "$OUT" "$OUT/onnx"
