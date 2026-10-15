# Workflows

A workflow is a state machine in the same YAML as the functions it calls. This is the replacement for wiring Step Functions by hand, and for rewriting that wiring when the client moves off AWS.

```yaml
workflows:
  checkout:
    engine: native          # native | portable. See defaults below.
    type: STANDARD          # STANDARD | EXPRESS. AWS uses this. Others ignore it.
    comment: Reserve then charge
    startAt: Reserve
    states:
      Reserve:
        type: task
        function: reserve
        next: Charge
        retry:
          - errors: [States.ALL]
            intervalSeconds: 2
            maxAttempts: 3
            backoffRate: 2
        catch:
          - errors: [States.ALL]
            next: Failed
      Charge:
        type: task
        function: charge
        next: Paid
      Paid:
        type: choice
        choices:
          - variable: $.paid
            booleanEquals: true
            next: Done
        default: Failed
      Wait:
        type: wait
        seconds: 5
        next: Charge
      Note:
        type: pass
        result: { note: "skipped" }
        next: Done
      Done:
        type: succeed
      Failed:
        type: fail
        error: PaymentFailed
        cause: paid was false
```

State types: `task`, `choice`, `wait`, `pass`, `succeed`, `fail`.

A choice rule has exactly one comparison: `stringEquals`, `numericEquals`, `numericGreaterThan`, or `booleanEquals`. `variable` is a path such as `$.paid` or `$.order.id`.

`task.function` must be a function in this file. The task receives the current payload. Your handler sees `event.type === "workflow"`, `event.workflow.name`, `event.workflow.step`, and the payload on `event.body`. Return `{ statusCode, body }`. The next state receives `body`.

## Engines

| Provider | Default | Native service |
| --- | --- | --- |
| AWS | native | Step Functions. Tasks use `arn:aws:states:::lambda:invoke` |
| Google Cloud | native | Workflows. Tasks are HTTP POST with OIDC to the function URI |
| Azure, Cloudflare, Alibaba, IBM, Oracle, Tencent, Huawei | portable | A runner function the kit adds |
| DigitalOcean | rejected | URLs are assigned by `doctl` at deploy, too late to plan the calls |

`engine: native` on a cloud without a native engine is downgraded to `portable`, and validate prints a warning.

Portable `wait` states longer than 10 seconds fail validation. The runner is one function invocation. Long waits belong on Step Functions or Google Cloud Workflows.

Cloudflare portable workflows need `provider.cloudflare.workersDevSubdomain` so the runner can build `https://<script>.<subdomain>.workers.dev` URLs.

## What the runner calls

On AWS the native state machine invokes Lambda directly. It does not use the public API URL, so there is no cycle between API Gateway and the state machine.

On Google Cloud the workflow calls the function URI plus the internal path.

On the portable engine the runner reads `SK_FUNCTION_URL_MAP` and posts to the internal path:

- most clouds: `/__sk/invoke/<function>`
- Azure: `/sk/invoke/<function>` (the host already prefixes `/api`)

The request header `x-sk-token` must match `SK_INVOKE_TOKEN`. The token is `random_password.sk_invoke_token` in Terraform. It is not written into the dashboard.

## Local

```bash
sk workflow checkout --data '{"sku":"sku-1"}'
```

This forces the portable engine on your machine and invokes each task with `sk invoke`. It does not start Step Functions.

## Examples

- [examples/workflow-native](../examples/workflow-native) AWS Step Functions, plus `serverless-kit.gcp.yml` for Workflows.
- [examples/workflow-portable](../examples/workflow-portable) the same idea on Azure, including a 2 second wait.

## Limits

The portable interpreter stops after 50 transitions, or after a state is visited more than 10 times. Native AWS and Google Cloud enforce their own quotas on top of the definition the kit generates.
