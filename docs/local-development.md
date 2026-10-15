# Local development

You can run a function before any cloud credentials exist.

## dev

```bash
sk dev
sk dev --port 4000
```

The server binds to `127.0.0.1`. It bundles every function, then matches HTTP routes from the YAML. A request to `GET /hello` calls the function whose route is `GET /hello`.

Cloudflare functions are called with a `Request`. Other functions receive an HTTP-shaped event and the response uses `statusCode`, `headers`, and `body`.

Direct invoke, including functions that have no HTTP route:

```bash
curl -s -X POST http://127.0.0.1:3000/__sk/call/ping \
  -H 'content-type: application/json' \
  -d '{"hello":"world"}'
```

The process stays up until you stop it.

## invoke

```bash
sk invoke hello
sk invoke hello --type http --method POST --path /hello --data '{"name":"ada"}'
sk invoke worker --type queue --data '{"ok":true}'
sk invoke worker --type schedule
sk invoke onObject --event ./payload.json
```

`--type` builds a sample cloud payload for the provider in your YAML and puts your JSON in the body. `--event` without `--type` passes the file through as the raw cloud event. Use that when you captured a real Lambda, Worker, or Functions payload.

`--type` values: `http`, `schedule`, `queue`, `topic`, `storage`, `event`, `stream`, `workflow`, `invoke`.

Oracle functions do not open port 8080 during local invoke. The kit sets `SK_ORACLE_LISTEN=0` around the call. The container image still listens, because that variable is unset in OCI.

## workflow

```bash
sk workflow checkout --data '{"sku":"sku-1"}'
```

Runs the portable interpreter in-process and invokes each task locally. Native Step Functions are not started.

## validate and package

```bash
sk validate
sk package
```

`sk package` writes `.serverless-kit/build`, `.serverless-kit/terraform`, a planned `deployment.json`, and a preview dashboard. The preview banner says to run `sk deploy` before the ARNs are real.

`sk plan` also runs `terraform init` and `terraform plan`. Terraform must be on `PATH`.

## doctor

```bash
sk doctor
```

Prints the Node version and whether `terraform`, `aws`, `gcloud`, `az`, and `doctl` are on `PATH`. A missing cloud CLI does not fail the command. You only need the CLI for the provider you deploy.
