#!/usr/bin/env bash
# scripts/ci-image.sh
# Build, smoke test, and conditionally publish versioned Docker images.
# Invocation: bash scripts/ci-image.sh

set -euo pipefail

# 1. Pipeline Inputs and Defaults
CIRCLE_BRANCH="${CIRCLE_BRANCH:-}"
CIRCLE_TAG="${CIRCLE_TAG:-}"
CIRCLE_SHA1="${CIRCLE_SHA1:-$(git rev-parse HEAD 2>/dev/null || echo 'localsha1234567890')}"
DOCKERHUB_USER="${DOCKERHUB_USER:-}"
DOCKERHUB_TOKEN="${DOCKERHUB_TOKEN:-}"
DRY_RUN="${DRY_RUN:-0}"
REPO_URL="https://github.com/LAZYGENIUS69/habit-tracker-node"
SHORT_SHA="${CIRCLE_SHA1:0:7}"

# 2. Push Decision & Tag Resolution
# Defined in one readable place
SHOULD_PUSH=false
PUBLISH_REASON=""
TARGET_TAGS=()

if [ -n "$CIRCLE_TAG" ]; then
  # Tag pattern must strictly match ^v[0-9]+\.[0-9]+\.[0-9]+$
  if [[ ! "$CIRCLE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Tag '$CIRCLE_TAG' does not match required semver pattern '^v[0-9]+\.[0-9]+\.[0-9]+$'" >&2
    exit 1
  fi

  SEMVER="${CIRCLE_TAG#v}"
  MAJOR_MINOR=$(echo "$SEMVER" | sed -E 's/^([0-9]+\.[0-9]+)\..*/\1/')

  # Read package.json version with grep and sed (no node dependency)
  PKG_VERSION=$(grep '"version"' package.json | head -n 1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')
  if [ "$SEMVER" != "$PKG_VERSION" ]; then
    echo "Error: Version mismatch! Git tag version ($SEMVER) differs from package.json version ($PKG_VERSION)" >&2
    exit 1
  fi

  SHOULD_PUSH=true
  TARGET_TAGS=("$SEMVER" "$MAJOR_MINOR")
elif [ -n "$CIRCLE_BRANCH" ]; then
  case "$CIRCLE_BRANCH" in
    main)
      SHOULD_PUSH=true
      TARGET_TAGS=("qa" "qa-${SHORT_SHA}")
      ;;
    staging)
      SHOULD_PUSH=true
      TARGET_TAGS=("stage" "stage-${SHORT_SHA}")
      ;;
    prod)
      SHOULD_PUSH=true
      TARGET_TAGS=("prod" "prod-${SHORT_SHA}")
      ;;
    *)
      SHOULD_PUSH=false
      PUBLISH_REASON="branch '$CIRCLE_BRANCH' is not a configured release branch (main, staging, prod)"
      ;;
  esac
else
  SHOULD_PUSH=false
  PUBLISH_REASON="neither release branch nor release tag is specified"
fi

# 3. Determine Local / Target Repository Name
if [ -n "$DOCKERHUB_USER" ]; then
  REPO_NAME="${DOCKERHUB_USER}/habit-tracker-node"
else
  REPO_NAME="habit-tracker-node"
fi
BUILD_TAG="${REPO_NAME}:${SHORT_SHA}"

# 4. Build Docker Image with OCI Labels
echo "=== Step 1: Building Docker Image ==="
echo "Build Tag: $BUILD_TAG"
echo "Revision:  $CIRCLE_SHA1"
echo "Source:    $REPO_URL"

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY_RUN] docker build -t \"$BUILD_TAG\" \\"
  echo "  --label \"revision=$CIRCLE_SHA1\" \\"
  echo "  --label \"source=$REPO_URL\" \\"
  echo "  --label \"org.opencontainers.image.revision=$CIRCLE_SHA1\" \\"
  echo "  --label \"org.opencontainers.image.source=$REPO_URL\" ."
else
  docker build -t "$BUILD_TAG" \
    --label "revision=$CIRCLE_SHA1" \
    --label "source=$REPO_URL" \
    --label "org.opencontainers.image.revision=$CIRCLE_SHA1" \
    --label "org.opencontainers.image.source=$REPO_URL" .
fi

# 5. Network-Isolated Smoke Tests
echo "=== Step 2: Running Container Smoke Tests ==="

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY_RUN] docker run --rm \"$BUILD_TAG\" id"
  echo "[DRY_RUN] docker run --rm \"$BUILD_TAG\" node -v"
  echo "[DRY_RUN] docker run --rm \"$BUILD_TAG\" sh -c \"test ! -e /app/.env && test ! -e /app/.git\""
else
  # 5a. Non-root unprivileged uid 1000 check
  USER_ID_OUTPUT=$(docker run --rm "$BUILD_TAG" id)
  echo "Smoke test [id]: $USER_ID_OUTPUT"
  if [[ ! "$USER_ID_OUTPUT" =~ uid=1000 ]]; then
    echo "Smoke test failure: Expected uid=1000, got: $USER_ID_OUTPUT" >&2
    exit 1
  fi

  # 5b. Pinned Node 20 runtime check
  NODE_VER_OUTPUT=$(docker run --rm "$BUILD_TAG" node -v)
  echo "Smoke test [node -v]: $NODE_VER_OUTPUT"
  if [[ ! "$NODE_VER_OUTPUT" =~ ^v20\. ]]; then
    echo "Smoke test failure: Expected Node 20.x runtime, got: $NODE_VER_OUTPUT" >&2
    exit 1
  fi

  # 5c. Filesystem hygiene check (no secrets, no git directory)
  echo "Smoke test [filesystem]: verifying no .env and no .git in /app"
  if ! docker run --rm "$BUILD_TAG" sh -c "test ! -e /app/.env && test ! -e /app/.git"; then
    echo "Smoke test failure: /app must not contain .env or .git" >&2
    exit 1
  fi
  echo "Smoke tests passed successfully."
fi

# 6. Push Stage
if [ "$SHOULD_PUSH" = false ]; then
  echo "not publishing: $PUBLISH_REASON"
  exit 0
fi

echo "=== Step 3: Publishing to Docker Hub ==="

# Explicit credential check naming the exact missing variable
if [ -z "$DOCKERHUB_USER" ]; then
  echo "Error: DOCKERHUB_USER environment variable is missing" >&2
  exit 1
fi

if [ -z "$DOCKERHUB_TOKEN" ]; then
  echo "Error: DOCKERHUB_TOKEN environment variable is missing" >&2
  exit 1
fi

# Secure login without set -x; never echoing secret credentials
if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY_RUN] echo '<token hidden>' | docker login -u \"$DOCKERHUB_USER\" --password-stdin"
  for tag in "${TARGET_TAGS[@]}"; do
    echo "[DRY_RUN] docker tag \"$BUILD_TAG\" \"${DOCKERHUB_USER}/habit-tracker-node:${tag}\""
    echo "[DRY_RUN] docker push \"${DOCKERHUB_USER}/habit-tracker-node:${tag}\""
  done
else
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USER" --password-stdin
  for tag in "${TARGET_TAGS[@]}"; do
    TARGET_IMAGE="${DOCKERHUB_USER}/habit-tracker-node:${tag}"
    echo "Tagging: $TARGET_IMAGE"
    docker tag "$BUILD_TAG" "$TARGET_IMAGE"
    echo "Pushing: $TARGET_IMAGE"
    docker push "$TARGET_IMAGE"
  done
fi

echo "Image publish complete."
