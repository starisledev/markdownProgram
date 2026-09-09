#!/usr/bin/env bash
# ============================================================
# 砚屿 Markora — 一键发布 v1.3.0 Release 到 GitHub
# 用法:
#   bash dist/publish_release.sh
# 说明: 自动从 Windows 凭据管理器读取 GitHub token（或使用 GH_TOKEN 环境变量）；
#       创建/更新 v1.3.0 Release，上传安装包 / 便携 zip / README，然后删除旧 v1.2.0 Release。
#       加 --keep-old 可保留旧 Release。
# ============================================================
set -euo pipefail

REPO="starisledev/markdownProgram"
TAG="v1.3.0"
NAME="砚屿 v1.3.0 — Typora 风格所见即所得 Markdown 编辑器"
KEEP_OLD="${1:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$ROOT/dist-electron/Markora-1.3.0-windows-x64.exe"
ZIP="$ROOT/dist-electron/Markora-1.3.0-windows-x64.zip"
NOTES="$ROOT/dist/release_notes_1.3.0.md"

if [[ -z "${GH_TOKEN:-}" ]]; then
  GH_TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "错误: 未找到 token。请先运行: export GH_TOKEN=ghp_xxx（需 starisledev/markdownProgram 写权限）" >&2
  exit 1
fi

for f in "$SETUP" "$ZIP" "$NOTES" "$ROOT/README.md"; do
  [[ -f "$f" ]] || { echo "缺少文件: $f" >&2; exit 1; }
done

AUTH="Authorization: Bearer $GH_TOKEN"
API="https://api.github.com/repos/$REPO"
UPLOAD="https://uploads.github.com/repos/$REPO"

echo "==> 创建/查找 Release $TAG"
# 用临时文件传 JSON body（Windows 下内联参数会破坏中文/emoji 字符导致 422）
BODY_FILE="$(mktemp)"
python - "$NOTES" "$BODY_FILE" <<'PYEOF'
import json, sys
body = open(sys.argv[1], encoding='utf-8').read()
with open(sys.argv[2], 'w', encoding='utf-8') as f:
    f.write(json.dumps({"tag_name": "v1.3.0",
                        "name": "砚屿 v1.3.0 — Typora 风格所见即所得 Markdown 编辑器",
                        "body": body, "draft": False, "prerelease": False}, ensure_ascii=False))
PYEOF
RELEASE_ID="$(curl -s -H "$AUTH" -H "Accept: application/vnd.github+json" -X POST "$API/releases" \
  -H "Content-Type: application/json" --data-binary "@$BODY_FILE" \
  | python -c "import json,sys; print(json.load(sys.stdin).get('id') or '')")"
rm -f "$BODY_FILE"
if [[ -z "$RELEASE_ID" ]]; then
  RELEASE_ID="$(curl -s -H "$AUTH" "$API/releases/tags/$TAG" \
    | python -c "import json,sys; print(json.load(sys.stdin).get('id') or '')")"
fi
[[ -n "$RELEASE_ID" ]] || { echo "创建 Release 失败，请检查 token 权限" >&2; exit 1; }
echo "    Release ID: $RELEASE_ID"

echo "==> 上传资产"
upload_asset() {
  local file="$1" mime="$2"
  local name; name="$(basename "$file")"
  local existing
  existing="$(curl -s -H "$AUTH" "$API/releases/$RELEASE_ID/assets" \
    | python -c "import json,sys; print(any(a['name']=='$name' for a in json.load(sys.stdin)))")"
  if [[ "$existing" == "True" ]]; then
    echo "    已存在，跳过: $name"
    return
  fi
  curl -s -o /dev/null -w "    %{http_code} $name\n" \
    -H "$AUTH" -H "Content-Type: $mime" \
    --data-binary "@$file" \
    "$UPLOAD/releases/$RELEASE_ID/assets?name=$name"
}
upload_asset "$SETUP" "application/vnd.microsoft.portable-executable"
upload_asset "$ZIP" "application/zip"
upload_asset "$ROOT/README.md" "text/markdown"

echo "==> 校验资产"
curl -s -H "$AUTH" "$API/releases/$RELEASE_ID/assets" \
  | python -c "import json,sys; [print('   ', a['name'], a['size']) for a in json.load(sys.stdin)]"

if [[ "$KEEP_OLD" == "--keep-old" ]]; then
  echo "==> 保留旧 Release"
else
  for OLDTAG in v1.2.0 v1.1.0; do
    OLD_ID="$(curl -s -H "$AUTH" "$API/releases/tags/$OLDTAG" \
      | python -c "import json,sys; print(json.load(sys.stdin).get('id') or '')")"
    if [[ -n "$OLD_ID" ]]; then
      curl -s -o /dev/null -w "==> 删除旧 $OLDTAG Release: %{http_code}\n" \
        -X DELETE -H "$AUTH" "$API/releases/$OLD_ID"
    fi
  done
fi

echo "==> 完成: https://github.com/$REPO/releases/tag/$TAG"
