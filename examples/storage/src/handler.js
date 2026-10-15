exports.handler = async function handler(event) {
  return {
    statusCode: 200,
    body: {
      bucket: event.storage && event.storage.bucket,
      key: event.storage && event.storage.key,
      eventName: event.storage && event.storage.eventName,
    },
  };
};
