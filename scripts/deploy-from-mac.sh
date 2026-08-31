#!/usr/bin/env bash
#
# deploy-from-mac.sh — build and deploy the portfolio from this Mac, on demand.
#
# WHY THIS EXISTS
#   GitHub Actions no longer builds on every push (see .github/workflows/deploy.yml —
#   the `push` trigger is deliberately gone). Nothing is automatic any more: the site
#   goes live when you run THIS, and at no other time. That trade buys back the
#   Actions minutes that ~13 pushes/day were spending, at the cost of having to say
#   "ship it" out loud.
#
#   Modelled on MHLHUB's scripts/deploy-from-mac.sh, which does the same thing for
#   the same reason. Same discipline: build a CLEAN WORKTREE at the pushed commit,
#   never whatever happens to be sitting in your working tree.
#
# WHY A LINUX CONTAINER AND NOT JUST macOS
#   This Mac's filesystem is CASE-INSENSITIVE. Cloudflare's is not. An import of
#   `./Header.astro` written as `./header.astro`, or a sprite referenced as
#   `homebase_5.png` when the file is `homeBase_5.png`, builds perfectly here and
#   404s in production. Building inside linux/amd64 reproduces the environment
#   ubuntu-latest gave us, so that class of bug still gets caught before it ships.
#
#   ARCHITECTURE — MEASURED, and the answer was not the obvious one.
#   The plan was linux/amd64 under Rosetta, to match ubuntu-latest exactly. Timing
#   the same build four ways says the exactness is not worth what it costs:
#
#     macOS native, no container   19s   wrong OS AND case-insensitive
#     linux/arm64 container        81s   <- default
#     linux/amd64 via Rosetta     189s   exact CI parity
#     GitHub-hosted ubuntu x64     84s   what we are replacing
#
#   arm64 lands on GitHub's own wall-clock for free; Rosetta costs 108s more.
#   Every arch-specific package here (sharp, esbuild, lightningcss, oxide,
#   rolldown, pagefind, workerd, the astro compiler) is a BUILD-TIME TOOL — what
#   ships to Cloudflare is JS and WASM, which is arch-independent. So amd64 buys
#   parity in a dimension the artifact does not have, while arm64 already fixes
#   the bug class that actually motivated the container: case sensitivity.
#
#   Pass --amd64 when you want the exact ubuntu-latest environment anyway, e.g.
#   reproducing a CI-only failure. If a package ever ships without a linux/arm64
#   build, `npm ci` fails loudly — a red error, never a silently wrong artifact.
#
# SITE_URL IS DELIBERATELY NOT SET
#   astro.config.mjs falls back to https://portfolio.dylansg0318.workers.dev when
#   SITE_URL is empty, and the repo variable is unset, so that is what CI has always
#   built against. Setting it here would silently change every canonical URL and the
#   sitemap. Leave it alone.
#
# CREDENTIALS
#   Read from the login keychain at run time; nothing is stored in this file or the
#   repo. The Passwords app is NOT readable by the `security` CLI (it lives in the
#   iCloud keychain), which is why these are separate items:
#
#     security add-generic-password -U -s portfolio-cf-token   -a CF_Token   -w
#     security add-generic-password -U -s portfolio-cf-account -a CF_Account -w
#
#   The first read pops a macOS dialog — choose "Always Allow".
#
# USAGE
#   ./scripts/deploy-from-mac.sh                 # confirm, then build + deploy
#   ./scripts/deploy-from-mac.sh --yes           # no prompt
#   ./scripts/deploy-from-mac.sh --build-only    # gates + build, no deploy
#   ./scripts/deploy-from-mac.sh --amd64         # exact CI parity, ~2.3x slower
#   ./scripts/deploy-from-mac.sh --ref <ref>     # deploy something other than origin/main
#   ./scripts/deploy-from-mac.sh --keep          # leave the build worktree for inspection
#
set -euo pipefail

# --- config ------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLIMA_PROFILE="portfolio"          # NOT `default` — that one belongs to MHLHUB's
                                    # break-glass script, which reuses whatever VM is
                                    # already running. Sharing it would let one project
                                    # silently resize the other's.
NODE_IMAGE="node:22-bookworm"       # matches actions/setup-node node-version: 22
WORKER_NAME="portfolio"
LIVE_URL="https://portfolio.dylansg0318.workers.dev"
KC_TOKEN_SVC="portfolio-cf-token";   KC_TOKEN_ACCT="CF_Token"
KC_ACCOUNT_SVC="portfolio-cf-account"; KC_ACCOUNT_ACCT="CF_Account"

REF="origin/main"; ASSUME_YES=0; BUILD_ONLY=0; PLATFORM="linux/arm64"; KEEP=0

# --- args --------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)     ASSUME_YES=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --amd64)      PLATFORM="linux/amd64" ;;
    --keep)       KEEP=1 ;;
    --ref)        REF="${2:?--ref needs a value}"; shift ;;
    -h|--help)    sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- helpers -----------------------------------------------------------------
log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m /!\\\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
log "Preflight..."
for bin in colima docker git curl security; do
  command -v "$bin" >/dev/null 2>&1 || die "missing '$bin' — install it and retry."
done

CLOUDFLARE_API_TOKEN="$(security find-generic-password -s "$KC_TOKEN_SVC" -a "$KC_TOKEN_ACCT" -w 2>/dev/null || true)"
CLOUDFLARE_ACCOUNT_ID="$(security find-generic-password -s "$KC_ACCOUNT_SVC" -a "$KC_ACCOUNT_ACCT" -w 2>/dev/null || true)"
if [ "$BUILD_ONLY" -eq 0 ]; then
  [ -n "$CLOUDFLARE_API_TOKEN" ]  || die "no Cloudflare token in the keychain. See the CREDENTIALS note at the top of this file."
  [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || die "no Cloudflare account id in the keychain. See the CREDENTIALS note at the top of this file."
fi
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# --- resolve the target commit -----------------------------------------------
log "Fetching origin..."
git -C "$REPO_ROOT" fetch --quiet origin || die "git fetch failed."
SHA="$(git -C "$REPO_ROOT" rev-parse "$REF" 2>/dev/null)" || die "cannot resolve ref '$REF'."
SHORT="${SHA:0:9}"
SUBJECT="$(git -C "$REPO_ROOT" log -1 --format=%s "$SHA" | cut -c1-72)"

# Say plainly what will NOT ship, so a forgotten commit is visible rather than silent.
if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null || [ -n "$(git -C "$REPO_ROOT" ls-files --others --exclude-standard)" ]; then
  warn "Working tree has uncommitted changes — they will NOT be deployed."
fi
AHEAD="$(git -C "$REPO_ROOT" rev-list --count "$SHA..HEAD" 2>/dev/null || echo 0)"
[ "$AHEAD" -gt 0 ] && warn "Local HEAD is $AHEAD commit(s) ahead of $REF — those will NOT be deployed. Push them first."

log "Target:   $SHORT — $SUBJECT"
log "Platform: $PLATFORM $([ "$PLATFORM" = linux/amd64 ] && echo '(Rosetta — exact CI parity, ~2.3x slower)' || echo '(native — case-sensitive Linux, ~81s)')"
log "Mode:     $([ "$BUILD_ONLY" -eq 1 ] && echo 'build only, no deploy' || echo "build + deploy to $WORKER_NAME")"

# --- confirm (deploy mutates the live site) ----------------------------------
if [ "$BUILD_ONLY" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  printf '\nDeploy %s to %s? [y/N] ' "$SHORT" "$LIVE_URL"
  read -r reply
  case "$reply" in [yY]|[yY][eE][sS]) ;; *) echo "Aborted."; exit 0 ;; esac
fi

# --- ensure the VM -----------------------------------------------------------
if ! colima status -p "$COLIMA_PROFILE" >/dev/null 2>&1; then
  log "Starting colima profile '$COLIMA_PROFILE' (first run takes ~60s)..."
  colima start -p "$COLIMA_PROFILE" --cpu 4 --memory 4 --disk 20 --vm-type vz --vz-rosetta
fi
export DOCKER_HOST="unix://$HOME/.colima/$COLIMA_PROFILE/docker.sock"
docker info >/dev/null 2>&1 || die "docker is not reachable on profile '$COLIMA_PROFILE'."

# --- clean build worktree (never build dirty local state) --------------------
# Under $HOME on purpose: colima bind-mounts $HOME into the VM, but macOS's
# $TMPDIR (/var/folders/...) is NOT mounted, so a temp dir there cannot be
# bind-mounted into the container.
BUILD_ROOT="$HOME/.cache/portfolio-deploy"
BUILD_DIR="$BUILD_ROOT/$SHORT-$$"
mkdir -p "$BUILD_ROOT"

cleanup() {
  [ "$KEEP" -eq 1 ] && { log "Build worktree kept at $BUILD_DIR"; return; }
  # node_modules may be written by the container's root user; if the plain remove
  # fails, delete it from inside a container that has the rights to.
  git -C "$REPO_ROOT" worktree remove --force "$BUILD_DIR" 2>/dev/null && return
  docker run --rm -v "$BUILD_DIR":/w alpine sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
  git -C "$REPO_ROOT" worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"
  git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
}
trap cleanup EXIT

log "Creating clean worktree at $SHORT..."
git -C "$REPO_ROOT" worktree add --quiet --detach "$BUILD_DIR" "$SHA" || die "could not create worktree."

# --- build (and deploy) inside Linux -----------------------------------------
# NOTE: SITE_URL is intentionally absent — see the header.
STEPS='npm ci --no-audit --no-fund && npm run check && npm run build'
[ "$BUILD_ONLY" -eq 0 ] && STEPS="$STEPS && npx wrangler deploy"

log "Building in $PLATFORM ($NODE_IMAGE)..."
START=$(date +%s)
docker run --rm \
  --platform "$PLATFORM" \
  -v "$BUILD_DIR":/app \
  -v portfolio-npm-cache:/root/.npm \
  -w /app \
  -e CI=1 \
  -e CLOUDFLARE_API_TOKEN \
  -e CLOUDFLARE_ACCOUNT_ID \
  "$NODE_IMAGE" \
  bash -euo pipefail -c "$STEPS" \
  || die "build/deploy failed — nothing was shipped."
ELAPSED=$(( $(date +%s) - START ))
log "Finished in ${ELAPSED}s."

# --- verify ------------------------------------------------------------------
if [ "$BUILD_ONLY" -eq 1 ]; then
  log "Build only — live site untouched."
  exit 0
fi

log "Verifying $LIVE_URL ..."
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$LIVE_URL" || echo 000)"
[ "$CODE" = "200" ] || die "deployed, but $LIVE_URL returned HTTP $CODE — check the Cloudflare dashboard."

log "Live: $LIVE_URL is serving $SHORT ($SUBJECT)"
