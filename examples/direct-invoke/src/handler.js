exports.handler = async function handler(event) {
  return { statusCode: 200, body: { echo: event.body ?? event.raw, provider: event.provider } };
};
