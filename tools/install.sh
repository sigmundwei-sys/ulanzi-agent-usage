#!/usr/bin/env bash
set -euo pipefail

readonly PLUGIN_NAME='com.ulanzi.agentusage.ulanziPlugin'
readonly REPOSITORY="${1:-${ULANZI_REPO:-}}"
readonly FORCE="${ULANZI_FORCE:-0}"

if [[ -z "$REPOSITORY" || ! "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Usage: install.sh <owner>/<repo> [--force]" >&2
  exit 2
fi

if [[ "${2:-}" == '--force' ]]; then
  export ULANZI_FORCE=1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo 'curl is required.' >&2
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo 'unzip is required.' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo 'npm is required. Install Node.js 20 or newer first.' >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo 'sha256sum or shasum is required to verify the release.' >&2
  exit 1
fi

readonly PLUGIN_DIRECTORY="${ULANZI_PLUGIN_DIR:-$HOME/Library/Application Support/Ulanzi/UlanziDeck/Plugins}"
readonly TEMP_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/ulanzi-agent-usage.XXXXXX")"
readonly ARCHIVE="$TEMP_DIRECTORY/$PLUGIN_NAME.zip"
readonly CHECKSUM="$TEMP_DIRECTORY/$PLUGIN_NAME.zip.sha256"
readonly DOWNLOAD_URL="https://github.com/$REPOSITORY/releases/latest/download/$PLUGIN_NAME.zip"
readonly TARGET="$PLUGIN_DIRECTORY/$PLUGIN_NAME"

cleanup() {
  rm -rf "$TEMP_DIRECTORY"
}
trap cleanup EXIT

echo "Downloading $DOWNLOAD_URL"
curl --fail --location --retry 3 --silent --show-error "$DOWNLOAD_URL" -o "$ARCHIVE"
curl --fail --location --retry 3 --silent --show-error "$DOWNLOAD_URL.sha256" -o "$CHECKSUM"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$TEMP_DIRECTORY" && sha256sum -c "$(basename "$CHECKSUM")")
else
  expected="$(awk '{print $1}' "$CHECKSUM")"
  actual="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  if [[ "$expected" != "$actual" ]]; then
    echo 'SHA-256 verification failed.' >&2
    exit 1
  fi
fi
unzip -q "$ARCHIVE" -d "$TEMP_DIRECTORY/unpacked"

readonly SOURCE="$TEMP_DIRECTORY/unpacked/$PLUGIN_NAME"
if [[ ! -d "$SOURCE" ]]; then
  echo "Release archive does not contain $PLUGIN_NAME/." >&2
  exit 1
fi

mkdir -p "$PLUGIN_DIRECTORY"
if [[ -e "$TARGET" ]]; then
  if [[ "${ULANZI_FORCE:-$FORCE}" != '1' ]]; then
    echo "Target already exists: $TARGET" >&2
    echo 'Re-run with --force or ULANZI_FORCE=1 to replace it.' >&2
    exit 3
  fi
  readonly BACKUP="$PLUGIN_DIRECTORY/$PLUGIN_NAME.backup.$(date +%Y%m%d%H%M%S)"
  mv -- "$TARGET" "$BACKUP"
  echo "Previous installation moved to $BACKUP"
fi

mv -- "$SOURCE" "$TARGET"
(
  cd "$TARGET"
  npm ci --ignore-scripts --no-audit --no-fund
)

echo "Installed $PLUGIN_NAME to $TARGET"
echo 'Restart Ulanzi Studio, then add the desired actions to your keys.'
