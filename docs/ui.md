# Dashboard

`sk package` and `sk deploy` write a single HTML file:

```
.serverless-kit/ui/index.html
```

Override the path with `ui.out`. Override the title with `ui.title`.

```yaml
ui:
  title: Shop production
  out: .serverless-kit/ui/index.html
```

Open the file in a browser, or serve it:

```bash
sk ui
sk ui --port 7070
```

`sk ui` binds to `127.0.0.1` and serves `/` and `/index.html`. It reads the file once at startup.

## What the page shows

For the service: provider, region, stage, runtime, and whether the model is `planned` or `deployed`.

For each function:

- logical name and physical name
- handler, provider runtime, memory, timeout, entry kind
- description
- ARN, id, and URL after deploy
- every trigger: type, HTTP method and path, schedule expression, queue or topic name
- environment key names

For each workflow: name, engine (`native` or `portable`), type, start state, and the state machine ARN when Terraform returned one.

A planned page has a banner that tells you to run `sk deploy`. A deployed page shows the timestamp from `deployment.json`.

## What the page never shows

- environment values
- `SK_INVOKE_TOKEN`
- cloud credentials
- Terraform state

`sk info` prints the same model as text. It reads `.serverless-kit/deployment.json` when that file exists, otherwise it prints the plan.

The page is static. It does not call the cloud. Refresh it by running `sk deploy` or `sk package` again.
