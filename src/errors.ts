export class KitError extends Error {
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "KitError";
    this.details = details;
  }
}

export class ConfigError extends KitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = "ConfigError";
  }
}

export class UnsupportedEventError extends KitError {
  constructor(provider: string, functionName: string, eventType: string, hint: string) {
    super(
      `Function "${functionName}" uses a "${eventType}" trigger. serverless-kit cannot deploy that trigger on ${provider}. ${hint}`,
    );
    this.name = "UnsupportedEventError";
  }
}

export class WorkflowError extends KitError {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}
