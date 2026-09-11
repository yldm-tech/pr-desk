#!/bin/sh
# Install the prdesk command line client from a published GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/yldm-tech/pr-desk/main/scripts/install-cli.sh | sh
#
# Environment:
#   PRDESK_VERSION      release tag to install, with or without the leading v
#                       (default: the latest release)
#   PRDESK_INSTALL_DIR  where to put the binary (default: ~/.local/bin)
#   PRDESK_REPO         owner/name to install from (default: yldm-tech/pr-desk)
#
# Nothing here needs root: the default target is inside the home directory.
set -eu

repo="${PRDESK_REPO:-yldm-tech/pr-desk}"
install_dir="${PRDESK_INSTALL_DIR:-$HOME/.local/bin}"
api="https://api.github.com/repos/$repo"

fail() {
	echo "prdesk install: $1" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

need curl
need mktemp

case "$(uname -s)" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) fail "unsupported operating system $(uname -s); build from source with: make cli" ;;
esac

case "$(uname -m)" in
arm64 | aarch64) arch=arm64 ;;
x86_64 | amd64) arch=amd64 ;;
*) fail "unsupported architecture $(uname -m); build from source with: make cli" ;;
esac

# A checksum that cannot be verified is worse than none, because it looks
# checked. Refuse rather than install something unverified.
if command -v sha256sum >/dev/null 2>&1; then
	checksum="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
	checksum="shasum -a 256"
else
	fail "neither sha256sum nor shasum is available, so the download cannot be verified"
fi

version="${PRDESK_VERSION:-}"
if [ -z "$version" ]; then
	# One field out of one document; a JSON parser is not worth requiring here.
	version=$(curl -fsSL "$api/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
	[ -n "$version" ] || fail "cannot determine the latest release of $repo"
fi
case "$version" in
v*) tag="$version" ;;
*) tag="v$version" ;;
esac

asset="prdesk-$os-$arch"
base="https://github.com/$repo/releases/download/$tag"

work=$(mktemp -d)
# Leaving a half-downloaded binary in a temporary directory helps nobody.
trap 'rm -rf "$work"' EXIT INT TERM

echo "prdesk install: fetching $tag for $os/$arch"
curl -fsSL --retry 3 -o "$work/$asset" "$base/$asset" ||
	fail "cannot download $asset from $tag; check that the release exists and carries command line binaries"
curl -fsSL --retry 3 -o "$work/SHA256SUMS" "$base/SHA256SUMS" ||
	fail "cannot download the checksums for $tag"

expected=$(grep "[[:space:]]$asset\$" "$work/SHA256SUMS" | cut -d' ' -f1)
[ -n "$expected" ] || fail "$tag publishes no checksum for $asset"
actual=$(cd "$work" && $checksum "$asset" | cut -d' ' -f1)
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset; refusing to install"

mkdir -p "$install_dir"
chmod 0755 "$work/$asset"
# Stage inside the destination first: a rename is only atomic within one file
# system, and the temporary directory is often on another. Replacing in place
# rather than writing over the old file also leaves a running prdesk alone.
staged="$install_dir/.prdesk.$$"
trap 'rm -rf "$work" "$staged"' EXIT INT TERM
cp "$work/$asset" "$staged"
mv -f "$staged" "$install_dir/prdesk"

echo "prdesk install: installed $("$install_dir/prdesk" version) to $install_dir/prdesk"

case ":$PATH:" in
*":$install_dir:"*) ;;
*) echo "prdesk install: $install_dir is not on PATH; add it to your shell profile" ;;
esac

echo "prdesk install: sign in with: prdesk login --host https://your-pr-desk --write"
