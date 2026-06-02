data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = var.ubuntu_os_version
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

data "oci_identity_availability_domains" "available" {
  compartment_id = var.compartment_ocid
}

locals {
  app_home                  = "/opt/no1-oci-ai-observability-hub"
  app_source_dir            = "${local.app_home}/source"
  app_repo_url              = "https://github.com/engchina/no.1-oci-ai-observability-hub.git"
  app_git_ref               = "main"
  availability_domain_input = trimspace(var.availability_domain)
  availability_domain_names = [for ad in data.oci_identity_availability_domains.available.availability_domains : ad.name]
  availability_domain       = contains(local.availability_domain_names, local.availability_domain_input) ? local.availability_domain_input : local.availability_domain_names[0]
  instance_image_id         = var.instance_image_ocid != "" ? var.instance_image_ocid : data.oci_core_images.ubuntu.images[0].id
  langfuse_git_ref          = "v${var.langfuse_version}"

  langfuse_config = templatefile("${path.module}/cloud_init/langfuse-config.env.tftpl", {
    app_home                    = local.app_home
    langfuse_version            = var.langfuse_version
    langfuse_git_ref            = local.langfuse_git_ref
    langfuse_web_image          = "docker.io/langfuse/langfuse:${var.langfuse_version}"
    langfuse_worker_image       = "docker.io/langfuse/langfuse-worker:${var.langfuse_version}"
    clickhouse_image            = "docker.io/clickhouse/clickhouse-server:${var.clickhouse_version}"
    minio_image                 = var.minio_image
    redis_image                 = "docker.io/redis:${var.redis_version}"
    postgres_image              = "docker.io/postgres:${var.postgres_version}"
    langfuse_init_org_id        = var.langfuse_init_org_id
    langfuse_init_org_name      = var.langfuse_init_org_name
    langfuse_init_user_email    = var.langfuse_admin_email
    langfuse_init_user_name     = var.langfuse_admin_name
    langfuse_init_user_password = var.langfuse_admin_password
  })

  cloud_init = templatefile("${path.module}/cloud_init/bootstrap.template.yaml", {
    app_git_ref     = local.app_git_ref
    app_home        = local.app_home
    app_repo_url    = local.app_repo_url
    app_source_dir  = local.app_source_dir
    langfuse_config = base64gzip(local.langfuse_config)
  })
}
