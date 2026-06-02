# no.1-oci-ai-observability-hub
Deploy Langfuse on OCI Compute and provide a friendly observability dashboard for OCI Generative AI / Enterprise AI logs, metrics, traces, costs, and request correlation.

## What This Deploys

This repository contains an OCI Terraform stack that provisions:

- One Ubuntu OCI Compute instance
- Host firewall rules for Langfuse (`3000`) and MinIO media uploads (`9090`)
- A cloud-init bootstrap that downloads this repository from GitHub `main` and runs `init_script.sh`
- Langfuse v3 via the official Docker Compose deployment

The OCI VCN, public subnet, and ingress rules for SSH, Langfuse (`3000`), and MinIO (`9090`) should be prepared before running the stack.

The Terraform/cloud-init pattern follows the same idea used by `engchina/No.1-RAG`: Terraform injects a cloud-init payload into OCI Compute, and the instance downloads the application repository from GitHub before running a first-boot init script.

## Files

- `init_script.sh`: downloaded from `engchina/no.1-oci-ai-observability-hub` on the `main` branch during boot; installs Docker, clones Langfuse, generates secrets, writes `.env`, creates `langfuse.service`, and starts Docker Compose.
- `terraform/stack`: OCI Resource Manager friendly Terraform stack.
- `terraform/stack/cloud_init`: cloud-init templates used to pass configuration and bootstrap the GitHub download.

## Deploy With Terraform CLI

```bash
cd terraform/stack
terraform init
terraform plan \
  -var='compartment_ocid=<compartment_ocid>' \
  -var='availability_domain=<availability_domain>' \
  -var='existing_vcn_id=<existing_vcn_ocid>' \
  -var='existing_subnet_id=<existing_public_subnet_ocid>' \
  -var='ssh_authorized_keys=<ssh_public_key>' \
  -var='langfuse_admin_email=<admin_email>' \
  -var='langfuse_admin_password=<admin_password>'
terraform apply
```

After apply, use the `langfuse_url` output. The default URL is:

```text
http://<instance-public-ip>:3000
```

## Deploy With OCI Resource Manager

Create a stack from this repository, set the working directory to `terraform/stack`, and provide:

- `compartment_ocid`
- `availability_domain`
- `existing_vcn_id`
- `existing_subnet_id`
- `ssh_authorized_keys`
- `langfuse_admin_email`
- `langfuse_admin_password`

Optional values include the compute shape, custom image OCID, pinned container image versions, and initial organization name.

For Network Configuration in OCI Resource Manager, select the existing VCN and existing public subnet that you prepared in advance.

The default pinned images are:

- `docker.io/langfuse/langfuse:3.176.0`
- `docker.io/langfuse/langfuse-worker:3.176.0`
- `docker.io/clickhouse/clickhouse-server:25.8`
- `cgr.dev/chainguard/minio@sha256:6357b3cbf5a16136bae0fbbf94406fef4de924f69b9632b0aaa5f788338ae6ad`
- `docker.io/redis:7.4`
- `docker.io/postgres:17.10`

The initial login username is `langfuse_admin_email`; the password is `langfuse_admin_password`.

## Operations

SSH to the instance using the `ssh_to_instance` output, then inspect startup logs:

```bash
sudo tail -f /var/log/cloud-init-langfuse.log /var/log/langfuse-init.log
```

Manage Langfuse:

```bash
sudo systemctl status langfuse
sudo systemctl restart langfuse
cd /opt/no1-oci-ai-observability-hub/langfuse
sudo docker compose --env-file .env ps
```
