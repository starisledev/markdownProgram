#!/usr/bin/env bash
# ============================================================
# 砚屿 Markora — 一键发布 v1.2.0 Release 到 GitHub
# 用法:
#   export GH_TOKEN=ghp_xxx            # 需要 starisledev/markdownProgram 的写权限
#   bash dist/publish_release.sh       # 完整发布（上传资产 + 删除旧 v1.1.0 Release）
#   bash dist/publish_release.sh --keep-old   # 保留旧 v1.1.0 Release
# ============================================================
set -euo pipefail

REPO="starisledev/markdownProgram"
TAG="v1.2.0"
NAME="砚屿 v1.2.0 — Typora 风格所见即所得 Markdown 编辑器"
KEEP_OLD="${1:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 安装包产物在构建机 C:\markora-target\release\bundle\ 下，可用环境变量覆盖路径
NSIS="${MARKORA_NSIS:-C:\\markora-target\\release\\bundle\\nsis\\Markora_1.2.0_x64-setup.exe}"
MSI="${MARKORA_MSI:-C:\\markora-target\\release\\bundle\\msi\\Markora_1.2.0_x64_en-US.msi}"
ZIP="$ROOT/dist/markora-v1.2.0-windows-x64.zip"
NOTES="$ROOT/dist/release_notes_1.2.0.md"

if [[ -z "${GH_TOKEN:-}" ]]; then
  # 回退：从 Windows 凭据管理器读取已保存的 GitHub token（git credential manager 存的 https 凭据）
  GH_TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "错误: 未找到 token。请先运行: export GH_TOKEN=ghp_xxx" >&2
  echo "      （需要 starisledev/markdownProgram 的写权限）" >&2
  exit 1
fi
for f in "$NSIS" "$MSI" "$ZIP" "$NOTES"; do
  [[ -f "$f" ]] || { echo "缺少文件: $f" >&2; exit 1; }
done

AUTH="Authorization: Bearer $GH_TOKEN"
API="https://api.github.com/repos/$REPO"
UPLOAD="https://uploads.github.com/repos/$REPO"

echo "==> 创建/查找 Release $TAG"
BODY="$(python - "$NOTES" <<'PYEOF'
import json, sys
body = open(sys.argv[1], encoding='utf-8').read()
print(json.dumps({"tag_name": "v1.2.0", "name": "砚屿 v1.2.0 — Typora 风格所见即所得 Markdown 编辑器",
                  "body": body, "draft": False, "prerelease": False}, ensure_ascii=False))
PYEOF
)"
RELEASE_ID="$(curl -s -H "$AUTH" -H "Accept: application/vnd.github+json" \
  -X POST "$API/releases" -H "Content-Type: application/json" --data-binary "$BODY" \
  | python -c "import json,sys; print(json.load(sys.stdin).get('id') or '')")"
if [[ -z "$RELEASE_ID" ]]; then
  # 可能已存在（幂等）：查找
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
upload_asset "$NSIS" "application/vnd.microsoft.portable-executable"
upload_asset "$MSI"  "application/x-ole-storage"
upload_asset "$ZIP"  "application/zip"
upload_asset "$ROOT/README.md" "text/markdown"

echo "==> 校验资产"
curl -s -H "$AUTH" "$API/releases/$RELEASE_ID/assets" \
  | python -c "import json,sys; [print('   ', a['name'], a['size']) for a in json.load(sys.stdin)]"

# 替换：删除旧 v1.1.0 Release（保留 git tag）
if [[ "$KEEP_OLD" == "--keep-old" ]]; then
  echo "==> 保留旧 v1.1.0 Release"
else
  OLD_ID="$(curl -s -H "$AUTH" "$API/releases/tags/v1.1.0" \
    | python -c "import json,sys; print(json.load(sys.stdin).get('id') or '')")"
  if [[ -n "$OLD_ID" ]]; then
    curl -s -o /dev/null -w "==> 删除旧 v1.1.0 Release: %{http_code}\n" \
      -X DELETE -H "$AUTH" "$API/releases/$OLD_ID"
  else
    echo "==> 未找到 v1.1.0 Release，跳过"
  fi
fi

echo "==> 完成: https://github.com/$REPO/releases/tag/$TAG"
