// Simplified rate limit middleware stub for testing environment.
// In production, replace with real implementation (e.g., express-rate-limit).

function createLimiter() {
  return (req, res, next) => next();
}

module.exports = { rateLimitMiddleware: { createLimiter } };
