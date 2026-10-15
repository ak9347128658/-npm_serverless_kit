# Changelog

## 0.1.0

First release of serverless-kit, published as `node_serverless_kit`. Author: Asif Khan @ Kavion.ai.

- YAML config for AWS, Google Cloud, Azure, Cloudflare, Alibaba Cloud, IBM Cloud, Oracle Cloud, Tencent Cloud, Huawei Cloud, and DigitalOcean.
- One JavaScript or TypeScript handler. A bundled adapter normalizes each cloud payload.
- Terraform generation for HTTP, schedules, queues, topics, storage, event buses, and streams where the provider can represent them.
- Native workflows on AWS Step Functions and Google Cloud Workflows. A portable HTTP runner everywhere else that supports it.
- `sk init`, `validate`, `package`, `plan`, `deploy`, `destroy`, `info`, `ui`, `invoke`, `workflow`, `dev`, and `doctor`.
- A local dashboard written after package and deploy. Environment values and the invoke token are left out of the page.
