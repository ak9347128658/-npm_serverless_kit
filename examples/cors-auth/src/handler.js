exports.handler = async function handler(event) {
  if (event.http && event.http.method === "GET") {
    return { statusCode: 200, body: { items: [] } };
  }
  return { statusCode: 201, body: { created: true, payload: event.body } };
};
