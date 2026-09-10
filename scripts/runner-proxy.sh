#!/usr/bin/env bash
#
# Translates the runner's proxy into whatever the tool about to run understands.
#
# These runners reach the internet only through a proxy, and three different tools in this pipeline each needed telling in a different dialect. Every one of them failed the same way first — quietly, as a timeout that read like an unreliable network:
#
#   docker build   `go mod download` died on `dial tcp 142.250.196.209:443: i/o timeout` about three minutes in, every run.
#   Gradle         The Android build sat for 28 minutes and was cancelled by the job timeout with no log at all; it takes 2m52s once it can reach Maven.
#   buildx         The release could not resolve `mirror.gcr.io/library/golang:1.26-alpine`, three seconds after `docker pull` fetched from that same host successfully.
#
# In each case the steps around it kept working, because they run under something that does read the environment — the docker daemon, or a Node action using @actions/http-client. That contrast is what made all three look like flakiness rather than configuration.
#
# One script rather than three inline blocks: it is one decision about where the proxy comes from, it is worth testing, and a fourth tool will want a fourth dialect.
#
#   scripts/runner-proxy.sh build-args    # --build-arg HTTP_PROXY=… , for `docker build` on a command line
#   scripts/runner-proxy.sh build-pairs   # HTTP_PROXY=… , for an action input that takes a list
#   scripts/runner-proxy.sh jvm-opts      # -Dhttp.proxyHost=… , for anything on a JVM
#   scripts/runner-proxy.sh driver-opts   # env.http_proxy=… , for buildx's docker-container driver
#
# Every mode prints nothing at all when the environment names no proxy, so a runner with a direct connection is left exactly as it is.
set -euo pipefail

http="${HTTP_PROXY:-${http_proxy:-}}"
https="${HTTPS_PROXY:-${https_proxy:-}}"
skip="${NO_PROXY:-${no_proxy:-}}"

# Falls back to the other scheme rather than to nothing: a runner that names only one is telling us where its single egress is, and refusing to use it for the other scheme would leave half the traffic on a route that does not exist.
: "${http:=$https}"
: "${https:=$http}"

usage() {
	echo "usage: runner-proxy.sh build-args|jvm-opts|driver-opts" >&2
	exit 2
}

# Splits a proxy URL into host and port. The port is optional in the URL and mandatory to the JVM, so the scheme's default stands in.
split_url() {
	local url=$1 scheme rest
	scheme="${url%%://*}"
	rest="${url#*://}"
	rest="${rest%%/*}"
	# Credentials in a proxy URL are legal and would otherwise land in the host.
	rest="${rest##*@}"
	host="${rest%%:*}"
	if [ "$rest" = "$host" ]; then
		case "$scheme" in
		https) port=443 ;;
		*) port=80 ;;
		esac
	else
		port="${rest##*:}"
	fi
}

case "${1:-}" in
build-args)
	# Predefined build args: BuildKit accepts them without the Dockerfile declaring anything, and keeps them out of the image and its history.
	[ -n "$http" ] || exit 0
	printf -- '--build-arg\nHTTP_PROXY=%s\n--build-arg\nHTTPS_PROXY=%s\n' "$http" "$https"
	if [ -n "$skip" ]; then
		printf -- '--build-arg\nNO_PROXY=%s\n' "$skip"
	fi
	;;
build-pairs)
	# The same forwarding as build-args, for docker/build-push-action's `build-args:` input rather than a command line.
	#
	# NO_PROXY is left out here and kept in build-args, and the asymmetry is deliberate. These action inputs are parsed as lists and split on commas, which is how `env.no_proxy=localhost,127.0.0.1,…` reached buildx as three fragments and stopped the builder from starting at all (`invalid value "127.0.0.1", expecting k=v`). A proxy URL never contains a comma; an exclusion list always does. On a command line there is no parser in the way, so build-args keeps it.
	#
	# Nothing is lost: what these build args reach is the RUN steps, and every host they contact — the Go module proxy, the npm registry, Alpine's mirrors — is external, which is exactly what the proxy is for.
	[ -n "$http" ] || exit 0
	printf 'HTTP_PROXY=%s\nHTTPS_PROXY=%s\n' "$http" "$https"
	;;
jvm-opts)
	# The JVM takes its proxy from system properties and ignores the environment entirely, which is the whole of why Gradle sat there.
	[ -n "$http" ] || exit 0
	split_url "$http"
	local_http_host=$host
	local_http_port=$port
	split_url "$https"
	# Java wants the exclusion list pipe-separated; the environment gives it comma-separated.
	nonproxy=$(printf '%s' "${skip:-localhost,127.0.0.1}" | tr ',' '|')
	printf -- '-Dhttp.proxyHost=%s -Dhttp.proxyPort=%s -Dhttps.proxyHost=%s -Dhttps.proxyPort=%s -Dhttp.nonProxyHosts=%s\n' \
		"$local_http_host" "$local_http_port" "$host" "$port" "$nonproxy"
	;;
driver-opts)
	# buildx's docker-container driver starts buildkitd as its own process with an empty environment; these are how anything reaches it.
	#
	# No no_proxy here, and it is not an oversight. setup-buildx-action splits driver-opts on commas as well as newlines and hands each piece to `buildx create --driver-opt`, so an exclusion list arrives as several fragments and buildx rejects the first one that is not a pair: `ERROR: invalid value "127.0.0.1", expecting k=v`. A comma-bearing value cannot cross this input. Nothing is lost — buildkitd talks to the registry mirror and to ghcr.io, both of which are exactly what the proxy is for, and it has no reason to reach anything an exclusion list would name.
	[ -n "$http" ] || exit 0
	printf 'env.http_proxy=%s\nenv.https_proxy=%s\n' "$http" "$https"
	;;
*) usage ;;
esac
