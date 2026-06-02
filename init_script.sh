#!/usr/bin/env bash
set -Eeuo pipefail

APP_HOME="${APP_HOME:-/opt/no1-oci-ai-observability-hub}"
CONFIG_FILE="${CONFIG_FILE:-${APP_HOME}/config.env}"
LANGFUSE_DIR="${LANGFUSE_DIR:-${APP_HOME}/langfuse}"
LANGFUSE_VERSION="${LANGFUSE_VERSION:-3.176.0}"
LANGFUSE_GIT_REF="${LANGFUSE_GIT_REF:-v${LANGFUSE_VERSION}}"
LANGFUSE_ENABLE_TELEMETRY="${LANGFUSE_ENABLE_TELEMETRY:-false}"
LANGFUSE_WEB_IMAGE="${LANGFUSE_WEB_IMAGE:-docker.io/langfuse/langfuse:${LANGFUSE_VERSION}}"
LANGFUSE_WORKER_IMAGE="${LANGFUSE_WORKER_IMAGE:-docker.io/langfuse/langfuse-worker:${LANGFUSE_VERSION}}"
CLICKHOUSE_IMAGE="${CLICKHOUSE_IMAGE:-docker.io/clickhouse/clickhouse-server:25.8}"
MINIO_IMAGE="${MINIO_IMAGE:-cgr.dev/chainguard/minio@sha256:6357b3cbf5a16136bae0fbbf94406fef4de924f69b9632b0aaa5f788338ae6ad}"
REDIS_IMAGE="${REDIS_IMAGE:-docker.io/redis:7.4}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/postgres:17.10}"
LOG_FILE="${LOG_FILE:-/var/log/langfuse-init.log}"

mkdir -p "${APP_HOME}"
touch "${LOG_FILE}"
chmod 0644 "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    log "This script must run as root."
    exit 1
  fi
}

load_config() {
  if [[ -f "${CONFIG_FILE}" ]]; then
    log "Loading configuration from ${CONFIG_FILE}"
    set -a
    # shellcheck disable=SC1090
    . "${CONFIG_FILE}"
    set +a
  fi
}

rand_hex() {
  openssl rand -hex "$1"
}

rand_b64() {
  openssl rand -base64 "$1" | tr -d '\n'
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  log "Installing base packages"
  apt-get update
  apt-get install -y ca-certificates curl git gnupg jq openssl iptables-persistent
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker and Docker Compose are already installed"
    systemctl enable --now docker
    return
  fi

  log "Installing Docker CE and Docker Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

open_host_firewall() {
  log "Opening local firewall ports for Langfuse"
  for port in 3000 9090; do
    if ! iptables -C INPUT -p tcp --dport "${port}" -j ACCEPT 2>/dev/null; then
      iptables -I INPUT -p tcp --dport "${port}" -j ACCEPT
    fi
  done
  netfilter-persistent save || true
}

detect_public_ip() {
  local public_ip=""

  public_ip="$(curl -fsS --max-time 10 http://whatismyip.akamai.com/ || true)"
  if [[ -z "${public_ip}" ]]; then
    public_ip="$(curl -fsS --max-time 10 https://ifconfig.me || true)"
  fi
  if [[ -z "${public_ip}" ]]; then
    public_ip="$(hostname -I | awk '{print $1}')"
  fi

  printf '%s' "${public_ip}"
}

normalize_url() {
  local value="$1"
  if [[ -z "${value}" ]]; then
    return 0
  fi
  if [[ "${value}" =~ ^https?:// ]]; then
    printf '%s' "${value}"
  else
    printf 'http://%s' "${value}"
  fi
}

append_dotenv() {
  local file="$1"
  local key="$2"
  local value="${3:-}"

  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  printf '%s=%s\n' "${key}" "${value}" >> "${file}"
}

read_dotenv_value() {
  local file="$1"
  local key="$2"
  local value

  value="$(sed -n "s/^${key}=//p" "${file}" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value}"
}

checkout_langfuse() {
  if [[ ! -d "${LANGFUSE_DIR}/.git" ]]; then
    log "Cloning Langfuse into ${LANGFUSE_DIR}"
    rm -rf "${LANGFUSE_DIR}"
    git clone https://github.com/langfuse/langfuse.git "${LANGFUSE_DIR}"
  fi

  log "Checking out Langfuse ref ${LANGFUSE_GIT_REF}"
  git -C "${LANGFUSE_DIR}" fetch --tags origin
  git -C "${LANGFUSE_DIR}" checkout "${LANGFUSE_GIT_REF}"
  git -C "${LANGFUSE_DIR}" pull --ff-only origin "${LANGFUSE_GIT_REF}" || true
}

load_existing_langfuse_env() {
  local env_file="${LANGFUSE_DIR}/.env"
  local key value

  if [[ -f "${env_file}" ]]; then
    log "Preserving existing generated secrets from ${env_file}"
    for key in NEXTAUTH_SECRET SALT ENCRYPTION_KEY POSTGRES_PASSWORD CLICKHOUSE_PASSWORD MINIO_ROOT_PASSWORD REDIS_AUTH; do
      value="$(read_dotenv_value "${env_file}" "${key}")"
      if [[ -n "${value}" ]]; then
        printf -v "${key}" '%s' "${value}"
      fi
    done
  fi
}

write_compose_override() {
  local override_file="${LANGFUSE_DIR}/docker-compose.override.yml"

  log "Pinning Docker images in ${override_file}"
  cat > "${override_file}" <<EOF
services:
  langfuse-worker:
    image: ${LANGFUSE_WORKER_IMAGE}
  langfuse-web:
    image: ${LANGFUSE_WEB_IMAGE}
  clickhouse:
    image: ${CLICKHOUSE_IMAGE}
  minio:
    image: ${MINIO_IMAGE}
  redis:
    image: ${REDIS_IMAGE}
  postgres:
    image: ${POSTGRES_IMAGE}
EOF
}

write_langfuse_env() {
  local public_ip nextauth_url minio_public_endpoint env_file

  public_ip="$(detect_public_ip)"
  nextauth_url="$(normalize_url "${LANGFUSE_EXTERNAL_URL:-}")"
  if [[ -z "${nextauth_url}" ]]; then
    nextauth_url="http://${public_ip}:3000"
  fi

  minio_public_endpoint="$(normalize_url "${LANGFUSE_MINIO_PUBLIC_ENDPOINT:-}")"
  if [[ -z "${minio_public_endpoint}" ]]; then
    minio_public_endpoint="http://${public_ip}:9090"
  fi

  NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-$(rand_b64 32)}"
  SALT="${SALT:-$(rand_b64 32)}"
  ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(rand_hex 32)}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(rand_hex 24)}"
  CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-$(rand_hex 24)}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(rand_hex 24)}"
  REDIS_AUTH="${REDIS_AUTH:-$(rand_hex 24)}"

  env_file="${LANGFUSE_DIR}/.env"
  log "Writing Langfuse environment to ${env_file}"
  : > "${env_file}"
  append_dotenv "${env_file}" LANGFUSE_VERSION "${LANGFUSE_VERSION}"
  append_dotenv "${env_file}" LANGFUSE_WEB_IMAGE "${LANGFUSE_WEB_IMAGE}"
  append_dotenv "${env_file}" LANGFUSE_WORKER_IMAGE "${LANGFUSE_WORKER_IMAGE}"
  append_dotenv "${env_file}" CLICKHOUSE_IMAGE "${CLICKHOUSE_IMAGE}"
  append_dotenv "${env_file}" MINIO_IMAGE "${MINIO_IMAGE}"
  append_dotenv "${env_file}" REDIS_IMAGE "${REDIS_IMAGE}"
  append_dotenv "${env_file}" POSTGRES_IMAGE "${POSTGRES_IMAGE}"
  append_dotenv "${env_file}" NEXTAUTH_URL "${nextauth_url}"
  append_dotenv "${env_file}" NEXTAUTH_SECRET "${NEXTAUTH_SECRET}"
  append_dotenv "${env_file}" DATABASE_URL "postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres"
  append_dotenv "${env_file}" SALT "${SALT}"
  append_dotenv "${env_file}" ENCRYPTION_KEY "${ENCRYPTION_KEY}"
  append_dotenv "${env_file}" TELEMETRY_ENABLED "${LANGFUSE_ENABLE_TELEMETRY}"
  append_dotenv "${env_file}" LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES "${LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES:-false}"
  append_dotenv "${env_file}" POSTGRES_USER "postgres"
  append_dotenv "${env_file}" POSTGRES_PASSWORD "${POSTGRES_PASSWORD}"
  append_dotenv "${env_file}" POSTGRES_DB "postgres"
  append_dotenv "${env_file}" CLICKHOUSE_USER "clickhouse"
  append_dotenv "${env_file}" CLICKHOUSE_PASSWORD "${CLICKHOUSE_PASSWORD}"
  append_dotenv "${env_file}" CLICKHOUSE_CLUSTER_ENABLED "false"
  append_dotenv "${env_file}" MINIO_ROOT_USER "minio"
  append_dotenv "${env_file}" MINIO_ROOT_PASSWORD "${MINIO_ROOT_PASSWORD}"
  append_dotenv "${env_file}" LANGFUSE_S3_EVENT_UPLOAD_BUCKET "langfuse"
  append_dotenv "${env_file}" LANGFUSE_S3_EVENT_UPLOAD_REGION "auto"
  append_dotenv "${env_file}" LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID "minio"
  append_dotenv "${env_file}" LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY "${MINIO_ROOT_PASSWORD}"
  append_dotenv "${env_file}" LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT "http://minio:9000"
  append_dotenv "${env_file}" LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE "true"
  append_dotenv "${env_file}" LANGFUSE_S3_MEDIA_UPLOAD_BUCKET "langfuse"
  append_dotenv "${env_file}" LANGFUSE_S3_MEDIA_UPLOAD_REGION "auto"
  append_dotenv "${env_file}" LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID "minio"
  append_dotenv "${env_file}" LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY "${MINIO_ROOT_PASSWORD}"
  append_dotenv "${env_file}" LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT "${minio_public_endpoint}"
  append_dotenv "${env_file}" LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE "true"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_ENABLED "false"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_BUCKET "langfuse"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_PREFIX "exports/"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_REGION "auto"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_ENDPOINT "http://minio:9000"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_EXTERNAL_ENDPOINT "${minio_public_endpoint}"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID "minio"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY "${MINIO_ROOT_PASSWORD}"
  append_dotenv "${env_file}" LANGFUSE_S3_BATCH_EXPORT_FORCE_PATH_STYLE "true"
  append_dotenv "${env_file}" REDIS_AUTH "${REDIS_AUTH}"
  append_dotenv "${env_file}" REDIS_TLS_ENABLED "false"
  append_dotenv "${env_file}" LANGFUSE_INIT_ORG_ID "${LANGFUSE_INIT_ORG_ID:-}"
  append_dotenv "${env_file}" LANGFUSE_INIT_ORG_NAME "${LANGFUSE_INIT_ORG_NAME:-}"
  append_dotenv "${env_file}" LANGFUSE_INIT_USER_EMAIL "${LANGFUSE_INIT_USER_EMAIL:-}"
  append_dotenv "${env_file}" LANGFUSE_INIT_USER_NAME "${LANGFUSE_INIT_USER_NAME:-}"
  append_dotenv "${env_file}" LANGFUSE_INIT_USER_PASSWORD "${LANGFUSE_INIT_USER_PASSWORD:-}"
  chmod 0600 "${env_file}"

  log "Langfuse URL: ${nextauth_url}"
  log "MinIO public endpoint: ${minio_public_endpoint}"
}

install_systemd_service() {
  log "Installing langfuse.service"
  cat > /etc/systemd/system/langfuse.service <<EOF
[Unit]
Description=Langfuse Docker Compose
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${LANGFUSE_DIR}
ExecStart=/usr/bin/docker compose --env-file ${LANGFUSE_DIR}/.env up -d
ExecStop=/usr/bin/docker compose --env-file ${LANGFUSE_DIR}/.env down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable langfuse.service
}

start_langfuse() {
  log "Starting Langfuse containers"
  systemctl restart langfuse.service
  docker compose --project-directory "${LANGFUSE_DIR}" --env-file "${LANGFUSE_DIR}/.env" ps
}

main() {
  require_root
  load_config
  install_base_packages
  install_docker
  open_host_firewall
  checkout_langfuse
  load_existing_langfuse_env
  write_compose_override
  write_langfuse_env
  install_systemd_service
  start_langfuse
  log "Langfuse initialization complete"
}

main "$@"
