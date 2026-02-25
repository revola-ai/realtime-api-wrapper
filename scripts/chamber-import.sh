#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat <<'EOF'
Import a .env-style file into Chamber (AWS SSM Parameter Store).

Usage:
  ./scripts/chamber-import.sh [options] <service-name> <env-file>

Examples:
  ./scripts/chamber-import.sh agent-orchestration-dev .env.local
  ./scripts/chamber-import.sh agent-orchestration-prod .env.production
  ./scripts/chamber-import.sh --dry-run retrieval-service-dev .env.local

Options:
  --dry-run           Print keys that would be written, but do not write.
  --preserve-case     Store keys exactly as written in the env file.
  --sleep <seconds>   Sleep between writes to avoid throttling (default: 0.2).
  -h, --help          Show this help.
EOF
}

DRY_RUN=0
PRESERVE_CASE=0
SLEEP_SECS="0.2"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --preserve-case)
      PRESERVE_CASE=1
      shift
      ;;
    --sleep)
      SLEEP_SECS="${2:?Missing value for --sleep}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

SERVICE="${1:?Usage: chamber-import.sh <service-name> <env-file>}"
ENV_FILE="${2:?Usage: chamber-import.sh <service-name> <env-file>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

if ! command -v chamber >/dev/null 2>&1; then
  echo "Error: chamber not found in PATH" >&2
  exit 127
fi

COUNT=0
ERRORS=0

# Read KEY=VALUE lines, skip comments and blanks.
# Supports optional leading "export ", and preserves values (including embedded '=')
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"

  # Trim leading whitespace for comment/blank detection
  line="${line#"${line%%[![:space:]]*}"}"

  [[ -z "$line" ]] && continue
  [[ "$line" == \#* ]] && continue
  [[ "$line" != *"="* ]] && continue

  # Allow "export KEY=VALUE"
  if [[ "$line" == export[[:space:]]* ]]; then
    line="${line#export }"
    line="${line#"${line%%[![:space:]]*}"}"
  fi

  # Split on first '=' only (values may contain '=')
  KEY="${line%%=*}"
  VALUE="${line#*=}"

  # Skip empty keys
  KEY="${KEY#"${KEY%%[![:space:]]*}"}"
  KEY="${KEY%"${KEY##*[![:space:]]}"}"
  [[ -z "$KEY" ]] && continue

  # Trim surrounding whitespace from value (does not strip internal whitespace)
  VALUE="${VALUE#"${VALUE%%[![:space:]]*}"}"
  VALUE="${VALUE%"${VALUE##*[![:space:]]}"}"

  # Strip surrounding quotes from value if present (single or double quotes)
  if [[ ${#VALUE} -ge 2 && "${VALUE:0:1}" == "\"" && "${VALUE: -1}" == "\"" ]]; then
    VALUE="${VALUE:1:-1}"
  elif [[ ${#VALUE} -ge 2 && "${VALUE:0:1}" == "'" && "${VALUE: -1}" == "'" ]]; then
    VALUE="${VALUE:1:-1}"
  fi

  STORE_KEY="$KEY"
  if (( ! PRESERVE_CASE )); then
    STORE_KEY="$(printf '%s' "$KEY" | tr '[:upper:]' '[:lower:]')"
  fi

  if (( DRY_RUN )); then
    if [[ "$STORE_KEY" != "$KEY" ]]; then
      echo "  - $KEY -> $STORE_KEY"
    else
      echo "  - $KEY"
    fi
    ((COUNT++)) || true
    continue
  fi

  OUTPUT="$(chamber write "$SERVICE" "$STORE_KEY" -- "$VALUE" 2>&1)"
  STATUS=$?
  if [[ $STATUS -eq 0 ]]; then
    echo "  ✓ $KEY"
    ((COUNT++)) || true
  else
    echo "  ✗ $KEY — $OUTPUT"
    ((ERRORS++)) || true
  fi

  # Small delay to avoid SSM throttling
  sleep "$SLEEP_SECS"
done < "$ENV_FILE"

echo ""
echo "Import complete for service '$SERVICE' ($COUNT keys, $ERRORS errors)"

if (( ERRORS > 0 )); then
  exit 1
fi
