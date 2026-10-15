exports.handler = async function handler(event) {
  const input = event.body || {};
  return { statusCode: 200, body: { reserved: true, sku: input.sku || "sku-1" } };
};
