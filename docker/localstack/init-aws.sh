#!/bin/bash
# Runs when LocalStack is ready: creates the dev bucket and a verified SES sender.
set -euo pipefail
awslocal s3api create-bucket --bucket packio-dev --create-bucket-configuration LocationConstraint=ap-southeast-1
awslocal ses verify-email-identity --email-address no-reply@packio.test
echo "localstack: packio-dev bucket and SES identity ready"
