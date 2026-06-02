output "instance_public_ip" {
  description = "Public IP address of the Langfuse compute instance."
  value       = oci_core_instance.langfuse.public_ip
}

output "ssh_to_instance" {
  description = "Convenient SSH command for the compute instance."
  value       = "ssh -o ServerAliveInterval=10 ubuntu@${oci_core_instance.langfuse.public_ip}"
}

output "langfuse_url" {
  description = "Langfuse web URL."
  value       = "http://${oci_core_instance.langfuse.public_ip}:3000"
}

output "minio_public_endpoint" {
  description = "MinIO endpoint used by Langfuse for direct media uploads."
  value       = "http://${oci_core_instance.langfuse.public_ip}:9090"
}

output "cloud_init_log" {
  description = "Command to inspect cloud-init and Langfuse setup logs."
  value       = "sudo tail -f /var/log/cloud-init-langfuse.log /var/log/langfuse-init.log"
}
