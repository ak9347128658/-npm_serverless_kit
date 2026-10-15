exports.handler = async function handler(event) {
  const records = event.records || [];
  const failures = [];
  for (const record of records) {
    if (!record.body || record.body.ok === false) {
      if (record.id) failures.push({ itemIdentifier: record.id });
    }
  }
  return { statusCode: 200, batchItemFailures: failures, body: { received: records.length } };
};
