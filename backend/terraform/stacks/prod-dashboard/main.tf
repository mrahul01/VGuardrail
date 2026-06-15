# ─────────────────────────────────────────────────────────────────────────────
# VGuardrail — production serving stack for dashboard.verisync.digital
#
# Provisions the public ingress + compute that the dev/Docker setup lacks:
#   * ECR repositories for the backend + dashboard images
#   * ECS Fargate cluster + two services (backend, dashboard)
#   * Application Load Balancer with an HTTPS (443) listener using the ACM cert
#   * Route53 A/ALIAS  dashboard.verisync.digital → ALB
#   * IAM task role granting the backend least-privilege access to the existing
#     DynamoDB tables, S3 audit bucket, Secrets Manager prefix, and Cognito.
#
# It REFERENCES (does not recreate) the existing data-plane (Cognito pool,
# DynamoDB tables, S3 bucket, secrets) via variables.
#
# Apply (creates billable resources — ALB + Fargate):
#   cd backend/terraform/stacks/prod-dashboard
#   terraform init
#   terraform apply -var-file=prod.tfvars
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ── Inputs ───────────────────────────────────────────────────────────────────
variable "region" { default = "us-east-1" }
variable "domain" { default = "dashboard.verisync.digital" }
variable "hosted_zone_id" { type = string } # Z04839603C3F6NO9HWP24
variable "acm_certificate_arn" { type = string } # the issued cert for var.domain
# Networking is created by this stack (see "Networking" below); no VPC/subnet
# inputs are required.

# Existing data-plane resources (referenced, not created).
variable "core_table_arn" { type = string }
variable "audit_table_arn" { type = string }
variable "audit_bucket_arn" { type = string }
variable "user_pool_arn" { type = string }
variable "enrollment_secret_arn" { type = string } # arn:...:secret:vguardrail/enrollment/*

# Runtime config (mirrors .env).
variable "env" {
  type = map(string)
  default = {
    VG_CORE_TABLE         = "vguardrail-core-prod"
    VG_AUDIT_TABLE        = "vguardrail-audit-prod"
    VG_AUDIT_BUCKET       = ""
    VG_USER_POOL_ID       = ""
    VG_APP_CLIENT_ID      = ""
    VG_DASHBOARD_CLIENT_ID = ""
    VG_COGNITO_ISSUER     = ""
    NEXT_PUBLIC_COGNITO_DOMAIN    = ""
    NEXT_PUBLIC_COGNITO_CLIENT_ID = ""
    COGNITO_ISSUER                = ""
  }
}
# Secret values are injected from SSM/Secrets Manager at deploy time, never here.
variable "cognito_client_secret_arn" { type = string }

locals {
  name = "vguardrail"
  tags = { project = "vguardrail", stack = "prod-dashboard" }
}

# ── Networking (self-contained: VPC + 2 public subnets + IGW) ────────────────
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = "${local.name}-prod" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = local.tags
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${local.name}-public-${count.index}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = local.tags
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

locals {
  vpc_id     = aws_vpc.this.id
  subnet_ids = aws_subnet.public[*].id
}

# ── ECR ──────────────────────────────────────────────────────────────────────
resource "aws_ecr_repository" "backend" {
  name                 = "${local.name}/backend"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = local.tags
}
resource "aws_ecr_repository" "dashboard" {
  name                 = "${local.name}/dashboard"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = local.tags
}

# ── ECS cluster ──────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "this" {
  name = "${local.name}-prod"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.tags
}

# ── IAM ──────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-prod-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role: least-privilege access for the backend to the data plane.
resource "aws_iam_role" "task" {
  name               = "${local.name}-prod-task"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}
data "aws_iam_policy_document" "task" {
  statement {
    sid     = "Dynamo"
    actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"]
    resources = [
      var.core_table_arn, "${var.core_table_arn}/index/*",
      var.audit_table_arn, "${var.audit_table_arn}/index/*",
    ]
  }
  statement {
    sid       = "S3Audit"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.audit_bucket_arn}/*"]
  }
  statement {
    sid       = "Secrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.enrollment_secret_arn, var.cognito_client_secret_arn]
  }
  statement {
    sid       = "Cognito"
    actions   = ["cognito-idp:AdminInitiateAuth", "cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:ListUsers", "cognito-idp:AdminDisableUser"]
    resources = [var.user_pool_arn]
  }
}
resource "aws_iam_role_policy" "task" {
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ── Security groups ──────────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  vpc_id      = local.vpc_id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}
resource "aws_security_group" "tasks" {
  name_prefix = "${local.name}-tasks-"
  vpc_id      = local.vpc_id
  ingress {
    description     = "dashboard from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description = "backend from dashboard (same SG)"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    self        = true
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

# ── ALB ──────────────────────────────────────────────────────────────────────
resource "aws_lb" "this" {
  name               = "${local.name}-prod"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.subnet_ids
  tags               = local.tags
}
resource "aws_lb_target_group" "dashboard" {
  name        = "${local.name}-dash"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = local.vpc_id
  target_type = "ip"
  health_check {
    path                = "/login"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = local.tags
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dashboard.arn
  }
}
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ── CloudWatch logs ──────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.name}-prod"
  retention_in_days = 30
  tags              = local.tags
}

# ── Task definitions ─────────────────────────────────────────────────────────
# The backend and dashboard run as two containers in one task so the dashboard
# reaches the backend at 127.0.0.1:8080 (matching BACKEND_API_URL).
resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-prod"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true
      portMappings = [{ containerPort = 8080 }]
      environment  = [for k, v in var.env : { name = k, value = v }]
      secrets = [
        { name = "COGNITO_CLIENT_SECRET", valueFrom = var.cognito_client_secret_arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "backend"
        }
      }
    },
    {
      name      = "dashboard"
      image     = "${aws_ecr_repository.dashboard.repository_url}:latest"
      essential = true
      dependsOn = [{ containerName = "backend", condition = "START" }]
      portMappings = [{ containerPort = 3000 }]
      environment = concat(
        [for k, v in var.env : { name = k, value = v }],
        [
          { name = "BACKEND_API_URL", value = "http://127.0.0.1:8080" },
          { name = "API_BASE_URL", value = "http://127.0.0.1:8080" },
          { name = "NEXT_PUBLIC_APP_URL", value = "https://${var.domain}" },
          { name = "COGNITO_REDIRECT_URI", value = "https://${var.domain}/api/auth/callback/cognito" },
          { name = "NODE_ENV", value = "production" },
        ],
      )
      secrets = [
        { name = "COGNITO_CLIENT_SECRET", valueFrom = var.cognito_client_secret_arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "dashboard"
        }
      }
    },
  ])
  tags = local.tags
}

resource "aws_ecs_service" "app" {
  name            = "${local.name}-prod"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = local.subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.dashboard.arn
    container_name   = "dashboard"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.https]
  tags       = local.tags
}

# ── DNS ──────────────────────────────────────────────────────────────────────
resource "aws_route53_record" "dashboard" {
  zone_id = var.hosted_zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

output "alb_dns_name" { value = aws_lb.this.dns_name }
output "dashboard_url" { value = "https://${var.domain}" }
output "ecr_backend" { value = aws_ecr_repository.backend.repository_url }
output "ecr_dashboard" { value = aws_ecr_repository.dashboard.repository_url }
