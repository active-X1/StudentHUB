// One structured log line per response. Logs the path only (no query string, which can carry tokens).
export function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const path = req.originalUrl.split('?')[0];
      const level = path.startsWith('/api/v1/health') ? 'debug' : res.statusCode >= 500 ? 'error' : 'info';
      logger[level]('request', { requestId: res.locals.requestId, method: req.method, path, status: res.statusCode, durationMs: Math.round(ms * 10) / 10 });
    });
    next();
  };
}
