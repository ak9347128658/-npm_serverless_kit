# Provider matrix

`yes` means `sk deploy` generates the trigger. `no` means `sk validate` fails with a hint before Terraform is written.

| Event | aws | gcp | azure | cloudflare | alibaba | ibm | oracle | tencent | huawei | digitalocean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| http | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| schedule | yes | yes | yes | yes | yes | yes | no | yes | yes | yes |
| queue | yes | yes | yes | yes | yes | no | no | yes | no | no |
| topic | yes | yes | yes | no | yes | no | no | yes | yes | no |
| storage | yes | yes | yes | no | yes | no | no | yes | yes | no |
| event bus | yes | yes | no | no | no | no | no | no | no | no |
| stream | yes | no | no | no | no | no | no | no | no | no |
| native workflow | yes | yes | no | no | no | no | no | no | no | no |
| portable workflow | yes | yes | yes | yes | yes | yes | yes | yes | yes | no |

Google Cloud queue, topic, and event bus all use Pub/Sub. A function may have one of those background triggers.

Huawei has no standalone queue in this kit. Use SMN (topic) or HTTP.

Tencent storage accepts one of `created` or `deleted` per function. Creating the bucket needs `provider.tencent.appId`.

Alibaba queue, topic, and storage need `provider.alibaba.roleArn` and a resource `name`.

Oracle deploy needs `provider.oracle.image`. `sk package` still writes a Dockerfile when the image is empty.

DigitalOcean schedules are `project.yml` triggers. The runtime in that file is `nodejs:18` even when YAML says `nodejs20` or `nodejs22`. The bundle target follows that.

## Runtimes

| Provider | `nodejs18` | `nodejs20` | `nodejs22` |
| --- | --- | --- | --- |
| AWS | `nodejs18.x` | `nodejs20.x` | `nodejs22.x` |
| Google Cloud | `nodejs18` | `nodejs20` | `nodejs22` |
| Azure | `18` | `20` | `22` |
| Cloudflare | Workers with `nodejs_compat` | same | same, with a warning |
| Alibaba | `nodejs18` | `nodejs20` | `nodejs20`, with a warning |
| IBM | `nodejs:18` | `nodejs:20` | `nodejs:20`, with a warning |
| Oracle | Docker `node:18` | `node:20` | `node:22` |
| Tencent | `Nodejs18.15` | `Nodejs20.15` | `Nodejs20.15`, with a warning |
| Huawei | `Node.js18.15` | `Node.js20.15` | `Node.js20.15`, with a warning |
| DigitalOcean | `nodejs:18` | `nodejs:18`, with a warning | `nodejs:18`, with a warning |

If a cloud account rejects a runtime id, set `runtime: nodejs18` and deploy again.
