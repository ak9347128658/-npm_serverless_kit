exports.handler = async function handler(event) {
  return {
    statusCode: 200,
    body: {
      source: event.event && event.event.source,
      detailType: event.event && event.event.detailType,
      detail: event.body,
    },
  };
};
