interface HelloEvent {
  provider: string;
  type: string;
  http?: { path: string; method: string };
}

interface HelloResult {
  statusCode: number;
  body: unknown;
}

export async function handler(event: HelloEvent): Promise<HelloResult> {
  return {
    statusCode: 200,
    body: {
      message: "hello from typescript",
      provider: event.provider,
      type: event.type,
      path: event.http?.path,
    },
  };
}
