# Quanttube – Global CDN Streaming Infrastructure
#
# Provisions the following resources on AWS:
#   • S3 bucket for HLS/DASH video segments (origin store)
#   • CloudFront distribution (global Edge CDN)
#   • CloudFront cache policy optimised for adaptive bitrate streaming
#
# Usage:
#   terraform init
#   terraform plan -var="region=us-east-1"
#   terraform apply

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

variable "region" {
  description = "AWS region for the origin S3 bucket"
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Name of the S3 bucket that stores HLS/DASH segments"
  type        = string
  default     = "quanttube-cdn-segments"
}

variable "price_class" {
  description = "CloudFront price class (controls Edge locations)"
  type        = string
  default     = "PriceClass_All" # worldwide Edge coverage
}

# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

provider "aws" {
  region = var.region
}

# ---------------------------------------------------------------------------
# S3 Origin – HLS / DASH segment storage
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "segments" {
  bucket = var.bucket_name

  tags = {
    Project     = "Quanttube"
    Component   = "cdn-origin"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_cors_configuration" "segments" {
  bucket = aws_s3_bucket.segments.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag", "Content-Length", "Content-Range"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_public_access_block" "segments" {
  bucket                  = aws_s3_bucket.segments.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Origin Access Control – CloudFront reads S3 without public bucket policy
resource "aws_cloudfront_origin_access_control" "segments" {
  name                              = "quanttube-segments-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# CloudFront Cache Policy – tuned for HLS/DASH manifests and segments
# ---------------------------------------------------------------------------

resource "aws_cloudfront_cache_policy" "streaming" {
  name        = "quanttube-streaming-policy"
  comment     = "Short TTL for HLS/DASH manifests; longer TTL for immutable segments"
  default_ttl = 2
  min_ttl     = 0
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config  { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# ---------------------------------------------------------------------------
# CloudFront Distribution – global CDN Edge
# ---------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "cdn" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = var.price_class
  comment         = "Quanttube global HLS/DASH CDN"

  origin {
    domain_name              = aws_s3_bucket.segments.bucket_regional_domain_name
    origin_id                = "s3-segments"
    origin_access_control_id = aws_cloudfront_origin_access_control.segments.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-segments"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.streaming.id
    compress               = true

    response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Project   = "Quanttube"
    Component = "cdn-edge"
    ManagedBy = "terraform"
  }
}

# CORS headers for browser-based HLS/DASH players
resource "aws_cloudfront_response_headers_policy" "cors" {
  name = "quanttube-cors-policy"

  cors_config {
    access_control_allow_credentials = false
    access_control_allow_headers   { items = ["*"] }
    access_control_allow_methods   { items = ["GET", "HEAD", "OPTIONS"] }
    access_control_allow_origins   { items = ["*"] }
    origin_override = true
  }
}

# Grant CloudFront OAC read access to the S3 bucket
resource "aws_s3_bucket_policy" "segments" {
  bucket = aws_s3_bucket.segments.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.segments.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn
        }
      }
    }]
  })
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "cdn_domain" {
  description = "CloudFront domain – use as CDN_BASE_URL in the API"
  value       = "https://${aws_cloudfront_distribution.cdn.domain_name}"
}

output "s3_bucket" {
  description = "S3 bucket for uploading HLS/DASH segments"
  value       = aws_s3_bucket.segments.bucket
}
