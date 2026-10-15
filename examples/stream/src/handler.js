exports.handler = async function handler(event) {
  return {
    statusCode: 200,
    body: { count: (event.records || []).length, provider: event.provider },
  };
};
