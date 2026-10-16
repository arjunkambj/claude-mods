#!/usr/bin/env bash
# Generate or edit images through the Codex CLI's built-in image_gen tool
# (uses the Codex ChatGPT subscription login; no OpenAI API key).
#
# Usage:
#   codex_image.sh (-p PROMPT | -f PROMPT_FILE) [-i IMAGE]... [-n COUNT]
#                  [-o OUT.png | -d OUT_DIR] [--force] [--effort LEVEL]
#
#   -p, --prompt       Prompt text (the full image spec).
#   -f, --prompt-file  Read the prompt from a file.
#   -i, --image        Input image to attach (repeatable, order matters).
#                      Images are edit targets or references as the prompt says.
#   -n, --count        Number of variants of this prompt (default 1).
#   -o, --out          Destination file. With several images, -1, -2 … are
#                      appended before the extension.
#   -d, --out-dir      Destination directory (files named image_1.png …).
#       --force        Overwrite existing destination files.
#       --effort       Codex reasoning effort (default low).
#
# Prints one destination path per line on stdout. Without -o or -d it prints
# the Codex paths under ~/.codex/generated_images instead.

set -euo pipefail

prompt=""
prompt_file=""
images=()
count=1
out=""
out_dir=""
force=0
effort="low"

die() { echo "Error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--prompt) prompt="$2"; shift 2 ;;
    -f|--prompt-file) prompt_file="$2"; shift 2 ;;
    -i|--image) images+=("$2"); shift 2 ;;
    -n|--count) count="$2"; shift 2 ;;
    -o|--out) out="$2"; shift 2 ;;
    -d|--out-dir) out_dir="$2"; shift 2 ;;
    --force) force=1; shift ;;
    --effort) effort="$2"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v codex >/dev/null || die "codex CLI not found. Install it and run 'codex login'."
[[ -n "$prompt" && -n "$prompt_file" ]] && die "use --prompt or --prompt-file, not both."
if [[ -n "$prompt_file" ]]; then
  [[ -f "$prompt_file" ]] || die "prompt file not found: $prompt_file"
  prompt="$(cat "$prompt_file")"
fi
[[ -n "$prompt" ]] || die "missing prompt."
[[ -n "$out" && -n "$out_dir" ]] && die "use --out or --out-dir, not both."
[[ "$count" =~ ^[1-9][0-9]*$ ]] || die "--count must be a positive integer."

attach=()
input_note=""
for index in ${images[@]+"${!images[@]}"}; do
  image="${images[$index]}"
  [[ -f "$image" ]] || die "input image not found: $image"
  attach+=(-i "$(cd "$(dirname "$image")" && pwd)/$(basename "$image")")
  input_note+="Attached image $((index + 1)): $(basename "$image")"$'\n'
done

if [[ "$count" -eq 1 ]]; then
  quantity="exactly one image"
else
  quantity="exactly $count separate variant images of the same spec, one image_gen call each"
fi

instructions="Use your built-in image generation tool (image_gen) to create $quantity.
Do not run shell commands, scripts, or APIs, and do not edit files.
If images are attached, use them as the spec below describes (edit target or reference).
Use the spec below verbatim as the image prompt; do not add creative requirements.
${input_note}
Image spec:
$prompt

When finished, reply with only the absolute file path of each generated image, one per line, and nothing else."

work="$(mktemp -d "${TMPDIR:-/tmp}/codex-image.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if ! codex exec --skip-git-repo-check --ephemeral -s read-only \
  -C "$work" -c "model_reasoning_effort=\"$effort\"" \
  -o "$work/last.txt" ${attach[@]+"${attach[@]}"} -- "$instructions" </dev/null >"$work/log.txt" 2>&1; then
  tail -20 "$work/log.txt" >&2
  die "codex exec failed (check 'codex login' and your plan's image limits)."
fi

# Collect every image in this session's folder (Codex's reply can omit some);
# fall back to the paths in its reply.
generated=()
session_id="$(sed -n 's/^session id: //p' "$work/log.txt" | head -1)"
session_dir="${CODEX_HOME:-$HOME/.codex}/generated_images/$session_id"
if [[ -n "$session_id" && -d "$session_dir" ]]; then
  while IFS= read -r file; do
    generated+=("$session_dir/$file")
  done < <(ls -tr "$session_dir")
fi
if [[ ${#generated[@]} -eq 0 ]]; then
  while IFS= read -r line; do
    line="${line//\`/}"
    line="$(echo "$line" | sed -e 's/^[[:space:]-]*//' -e 's/[[:space:]]*$//')"
    [[ -f "$line" ]] && generated+=("$line")
  done < "$work/last.txt"
fi

if [[ ${#generated[@]} -eq 0 ]]; then
  cat "$work/last.txt" >&2
  die "Codex did not report any generated image."
fi

if [[ ${#generated[@]} -ne "$count" ]]; then
  echo "Warning: asked for $count image(s), Codex produced ${#generated[@]}." >&2
fi

if [[ -z "$out" && -z "$out_dir" ]]; then
  printf '%s\n' "${generated[@]}"
  exit 0
fi

destinations=()
for index in "${!generated[@]}"; do
  source="${generated[$index]}"
  ext="${source##*.}"
  if [[ -n "$out_dir" ]]; then
    dest="$out_dir/image_$((index + 1)).$ext"
  elif [[ ${#generated[@]} -eq 1 ]]; then
    dest="$out"
  else
    dest="${out%.*}-$((index + 1)).${out##*.}"
  fi
  [[ -e "$dest" && "$force" -eq 0 ]] && die "$dest exists; pass --force or choose another name. Codex output: $source"
  destinations+=("$dest")
done

for index in "${!generated[@]}"; do
  mkdir -p "$(dirname "${destinations[$index]}")"
  cp "${generated[$index]}" "${destinations[$index]}"
done
printf '%s\n' "${destinations[@]}"
