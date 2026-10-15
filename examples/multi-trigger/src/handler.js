exports.handler = async function handler(event, context) {
  return {
    statusCode: 200,
    body: {
      type: event.type,
      function: context.logicalName,
      provider: event.provider,
    },
  };
};
