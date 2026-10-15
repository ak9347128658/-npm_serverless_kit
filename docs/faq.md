# FAQ

## Does the handler change when I change clouds?

No. Change `provider` in the YAML. `sk deploy` rebuilds the bundle entry and the Terraform. Branch on `event.type`, not on the cloud, unless you read `event.raw` for a field the kit does not normalize.

## Where is the Step Functions definition?

Under `workflows` in the same YAML. On AWS that becomes a state machine. On Google Cloud it becomes a Workflow. Elsewhere it becomes the portable runner, except DigitalOcean, which is rejected. See [workflows.md](workflows.md).

## Why did validate reject my trigger?

The provider matrix marks it `no`, or a required field is missing (`gcp.project`, `alibaba.roleArn`, `tencent.appId` for a new COS bucket, Huawei `agency`, a queue `name` on Alibaba or Tencent). The error names the function and the event. The matrix is [provider-matrix.md](provider-matrix.md).

## Why are there two functions on Google Cloud?

Gen2 allows one event trigger. HTTP and schedules share the HTTP function because Scheduler calls that URL. A queue, topic, storage event, or event bus is a second function. Both still use your handler.

## Why does Azure show several functions for one YAML entry?

`function.json` has one trigger. The kit deploys one function per event and keeps your logical name in the dashboard.

## Can two Azure functions have different environment values?

Only when the key is the same value, or when the key is `SK_FUNCTION_NAME` or `SK_LOGICAL_NAME` (those are compiled into the bundle). Any other conflict stops generation. App settings are service-wide.

## The dashboard has no URL.

`sk package` writes a preview. URLs and ARNs appear after `sk deploy`, and only when that trigger has a public address. A queue-only function has an ARN and a null URL. DigitalOcean reports the id `deployed-by-doctl` because `doctl` does not return URLs to Terraform.

## Does the HTML contain secrets?

No. It lists environment key names. It does not list values, the invoke token, or credentials.

## Oracle apply failed on an empty image.

`sk package` writes the Dockerfile either way. `sk deploy` refuses to run until `provider.oracle.image` is the OCIR tag you pushed. `sk plan` still renders `image = ""` so you can read the rest of the plan.

## Tencent rejected the zip or the runtime.

Inline `filebase64` is for small packages. Shrink the bundle or set `package.external` for modules you will not include. If the runtime id is rejected, set `runtime: nodejs18`.

## Huawei queue?

Not generated. FunctionGraph's queue products need a Kafka or RabbitMQ instance. Use a topic (`SMN`) or an HTTP route.

## The next deploy deleted my edits to main.tf.

`sk package` and `sk deploy` rewrite `*.tf`. State is kept. Put extra resources in a hook that runs after package, and accept that you must re-apply them, or own Terraform yourself and use the kit only to bundle.

## Node 22 on Cloudflare or DigitalOcean?

Cloudflare runs the bundle with `nodejs_compat`, not a Node 22 process. DigitalOcean project files use `nodejs:18`. Both print a warning. Avoid built-ins those platforms do not provide.

## Where do tests live?

`npm test` runs the suite in `test/`. `npm run typecheck` is `tsc --noEmit`. `npm run build` writes `dist/`. The example YAML files are parsed and rendered by `test/examples.test.ts`.
