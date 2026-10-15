exports.handler = async function handler(event) {
  const input = event.body || {};
  return { statusCode: 200, body: { paid: true, sku: input.sku } };
};
