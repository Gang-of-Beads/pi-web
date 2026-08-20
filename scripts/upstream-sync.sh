#!/usr/bin/env bash
#
# Report (and optionally take) what upstream has that this fork does not.
#
# The fork carries ~100 commits of its own, so a merge is not the routine
# operation - reading the difference is. Left unattended the two diverge until
# nobody can say whether an upstream fix is missing or was deliberately
# skipped, so this prints the outstanding commits, the files they touch, and
# the ones already recorded as declined.
#
# Usage:
#   scripts/upstream-sync.sh                 # report only
#   scripts/upstream-sync.sh --pick <sha>…   # cherry-pick with provenance (-x)
#   scripts/upstream-sync.sh --decline <sha> --reason "…"
#
# Declined commits live in docs/upstream-declined.tsv so the reason survives in
# the repository rather than in a chat log.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

upstream_remote="${PI_WEB_UPSTREAM_REMOTE:-origin}"
upstream_branch="${PI_WEB_UPSTREAM_BRANCH:-main}"
declined_file="docs/upstream-declined.tsv"

mode=report
picks=()
reason=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pick) mode=pick; shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do picks+=("$1"); shift; done ;;
    --decline) mode=decline; shift; picks+=("$1"); shift ;;
    --reason) shift; reason="${1:-}"; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

git fetch -q "$upstream_remote" "$upstream_branch"
upstream="$upstream_remote/$upstream_branch"

declined_shas() {
  [ -f "$declined_file" ] || return 0
  awk -F'\t' 'NR > 1 { print $1 }' "$declined_file"
}

case "$mode" in
  report)
    behind=$(git rev-list --count "HEAD..$upstream")
    ahead=$(git rev-list --count "$upstream..HEAD")
    echo "upstream: $upstream"
    echo "fork is $ahead commit(s) ahead, $behind commit(s) behind"
    [ "$behind" -eq 0 ] && { echo "nothing outstanding"; exit 0; }
    echo
    declined="$(declined_shas | tr '\n' ' ')"
    outstanding=0
    # `git cherry` compares patch content, so a commit already cherry-picked
    # here is reported as taken even though its sha differs. Plain `git log
    # HEAD..upstream` cannot tell those apart and would keep flagging work that
    # is already in the fork.
    while read -r marker sha subject; do
      status=$([ "$marker" = "-" ] && echo "taken" || echo "OUTSTANDING")
      short=$(git rev-parse --short "$sha")
      case " $declined " in *" $short "*) status="declined" ;; esac
      # A squash merge rewrites the patch id of everything it absorbs, so
      # `git cherry` stops recognising a commit the fork demonstrably has.
      # Before believing it, diff the files the commit touched: if HEAD already
      # matches upstream there, the change arrived, whatever its sha became.
      if [ "$status" = "OUTSTANDING" ]; then
        touched=$(git show --pretty= --name-only "$sha" | grep -v '^\.changeset/' || true)
        if [ -n "$touched" ] && git diff --quiet "$sha" HEAD -- $touched; then
          status="taken"
        fi
      fi
      [ "$status" = "OUTSTANDING" ] && outstanding=$((outstanding + 1))
      printf '%-12s %s  %s  %s\n' "$status" "$short" "$(git log -1 --format=%ad --date=short "$sha")" "$subject"
      [ "$status" = "OUTSTANDING" ] || continue
      git show --stat --format= "$sha" | sed 's/^/                 /' | head -8
    done < <(git cherry -v HEAD "$upstream" | sed 's/^\(.\) \([0-9a-f]*\) /\1 \2 /')
    echo
    echo "outstanding: $outstanding"
    ;;
  pick)
    [ "${#picks[@]}" -gt 0 ] || { echo "--pick needs at least one sha" >&2; exit 2; }
    # -x records the upstream sha in the message, which is what makes a later
    # report able to tell "already taken" from "never looked at".
    git cherry-pick -x "${picks[@]}"
    echo "picked: ${picks[*]}"
    echo "run: npm run verify"
    ;;
  decline)
    [ "${#picks[@]}" -eq 1 ] || { echo "--decline takes one sha" >&2; exit 2; }
    [ -n "$reason" ] || { echo "--decline requires --reason" >&2; exit 2; }
    mkdir -p "$(dirname "$declined_file")"
    [ -f "$declined_file" ] || printf 'sha\tsubject\treason\n' > "$declined_file"
    subject=$(git log -1 --format='%s' "${picks[0]}")
    printf '%s\t%s\t%s\n' "$(git rev-parse --short "${picks[0]}")" "$subject" "$reason" >> "$declined_file"
    echo "recorded as declined: ${picks[0]}"
    ;;
esac
