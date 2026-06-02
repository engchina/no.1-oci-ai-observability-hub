resource "oci_core_instance" "langfuse" {
  availability_domain = local.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = var.instance_display_name
  shape               = var.instance_shape

  availability_config {
    is_live_migration_preferred = true
    recovery_action             = "RESTORE_INSTANCE"
  }

  create_vnic_details {
    assign_private_dns_record = true
    assign_public_ip          = true
    display_name              = "${var.instance_display_name}-vnic"
    hostname_label            = "langfuse"
    subnet_id                 = local.selected_subnet_id
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  metadata = {
    ssh_authorized_keys = var.ssh_authorized_keys
    user_data           = base64gzip(local.cloud_init)
  }

  platform_config {
    is_symmetric_multi_threading_enabled = true
    type                                 = "AMD_VM"
  }

  shape_config {
    baseline_ocpu_utilization = "BASELINE_1_1"
    memory_in_gbs             = var.instance_flex_shape_memory
    ocpus                     = var.instance_flex_shape_ocpus
  }

  source_details {
    boot_volume_size_in_gbs = var.instance_boot_volume_size
    boot_volume_vpus_per_gb = var.instance_boot_volume_vpus
    source_id               = local.instance_image_id
    source_type             = "image"
  }
}
