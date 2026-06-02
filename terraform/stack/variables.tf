variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID where Langfuse infrastructure will be created."
}

variable "availability_domain" {
  type        = string
  description = "Availability domain for the compute instance."
  default     = "bxtG:AP-TOKYO-1-AD-1"
}

variable "ssh_authorized_keys" {
  type        = string
  description = "SSH public key installed for the ubuntu user."
}

variable "instance_display_name" {
  type        = string
  description = "Display name for the Langfuse compute instance."
  default     = "no1-langfuse"
}

variable "instance_shape" {
  type        = string
  description = "OCI compute shape."
  default     = "VM.Standard.E4.Flex"
}

variable "instance_flex_shape_ocpus" {
  type        = number
  description = "OCPUs for flexible shapes. Langfuse recommends at least 4 cores for v3 docker compose."
  default     = 2
}

variable "instance_flex_shape_memory" {
  type        = number
  description = "Memory in GiB for flexible shapes."
  default     = 16
}

variable "instance_boot_volume_size" {
  type        = number
  description = "Boot volume size in GiB."
  default     = 100
}

variable "instance_boot_volume_vpus" {
  type        = number
  description = "Boot volume VPUs per GiB."
  default     = 10
}

variable "instance_image_ocid" {
  type        = string
  description = "Optional custom image OCID. Leave empty to use the latest Canonical Ubuntu image for the selected shape."
  default     = ""
}

variable "ubuntu_os_version" {
  type        = string
  description = "Ubuntu image version used when instance_image_ocid is empty."
  default     = "22.04"
}

variable "existing_vcn_id" {
  type        = string
  description = "Existing VCN OCID that contains the public subnet for the Langfuse compute instance."

  validation {
    condition     = length(trimspace(var.existing_vcn_id)) > 0
    error_message = "existing_vcn_id is required."
  }
}

variable "existing_subnet_id" {
  type        = string
  description = "Existing public subnet OCID for the Langfuse compute instance."

  validation {
    condition     = length(trimspace(var.existing_subnet_id)) > 0
    error_message = "existing_subnet_id is required."
  }
}

variable "langfuse_version" {
  type        = string
  description = "Pinned Langfuse version. The deployment checks out v<version> and pins langfuse/langfuse plus langfuse-worker to this tag."
  default     = "3.176.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.langfuse_version))
    error_message = "langfuse_version must be a semantic version such as 3.176.0."
  }
}

variable "clickhouse_version" {
  type        = string
  description = "Pinned ClickHouse Docker image tag."
  default     = "25.8"
}

variable "minio_image" {
  type        = string
  description = "Pinned MinIO Docker image reference. The default keeps the Langfuse official Chainguard MinIO image and pins it by digest."
  default     = "cgr.dev/chainguard/minio@sha256:6357b3cbf5a16136bae0fbbf94406fef4de924f69b9632b0aaa5f788338ae6ad"
}

variable "redis_version" {
  type        = string
  description = "Pinned Redis Docker image tag."
  default     = "7.4"
}

variable "postgres_version" {
  type        = string
  description = "Pinned Postgres Docker image tag."
  default     = "17.10"
}

variable "langfuse_init_org_id" {
  type        = string
  description = "Langfuse initial organization ID. Required for headless initial user creation."
  default     = "no1-observability"
}

variable "langfuse_init_org_name" {
  type        = string
  description = "Langfuse initial organization name."
  default     = "No.1 OCI AI Observability Hub"
}

variable "langfuse_admin_email" {
  type        = string
  description = "Email used to create the initial Langfuse login user."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.langfuse_admin_email))
    error_message = "langfuse_admin_email must be a valid email address."
  }
}

variable "langfuse_admin_name" {
  type        = string
  description = "Display name for the initial Langfuse login user."
  default     = "Langfuse Admin"
}

variable "langfuse_admin_password" {
  type        = string
  description = "Password used to create the initial Langfuse login user."
  sensitive   = true

  validation {
    condition     = can(regex("^[A-Za-z0-9._@%+=:,/!~-]{12,128}$", var.langfuse_admin_password))
    error_message = "langfuse_admin_password must be 12-128 characters and may only contain letters, numbers, and . _ @ % + = : , / ! ~ -."
  }
}
