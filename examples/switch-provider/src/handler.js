exports.handler = async function handler(event, context) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: {
      message: "hello from serverless-kit",
      provider: event.provider,
      type: event.type,
      path: event.http && event.http.path,
      function: context.logicalName,
    },
  };
};
