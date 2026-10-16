#!/bin/bash
# Runs when LocalStack is ready: creates the dev bucket and a verified SES sender.
set -euo pipefail
awslocal s3api create-bucket --bucket getpack-dev --create-bucket-configuration LocationConstraint=ap-southeast-1
awslocal ses verify-email-identity --email-address no-reply@getpack.test
echo "localstack: getpack-dev bucket and SES identity ready"
