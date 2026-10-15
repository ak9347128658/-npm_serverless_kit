exports.handler = async function handler(event) {
  return {
    statusCode: 200,
    body: {
      ranAt: event.schedule && event.schedule.time,
      provider: event.provider,
    },
  };
};
