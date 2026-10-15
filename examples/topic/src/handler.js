exports.handler = async function handler(event) {
  return {
    statusCode: 200,
    body: {
      topic: event.topic && event.topic.name,
      messages: (event.records || []).map((record) => record.body),
    },
  };
};
