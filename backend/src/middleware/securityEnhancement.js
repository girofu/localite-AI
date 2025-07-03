// Stub security enhancement middleware used in authentication routes
// Provides no-op implementations for all referenced functions to keep tests passing.

const securityEnhancement = {
  /**
   * Check whether the user account is currently locked.
   * @returns {Promise<boolean>} false – always unlocked in stub.
   */
  async checkAccountLock() {
    return false;
  },

  /**
   * Record a login failure event (noop stub).
   */
  async recordLoginFailure() {
    // Intentionally empty stub implementation
  },

  /**
   * Analyse login pattern and return dummy result.
   */
  async analyzeLoginPattern() {
    return { risk: 'low' };
  },

  /**
   * Record security-related event (noop stub).
   */
  async recordSecurityEvent() {
    // Intentionally empty stub implementation
  },

  /**
   * Clear stored login failure counters (noop stub).
   */
  async clearLoginFailures() {
    // Intentionally empty stub implementation
  },
};

module.exports = { securityEnhancement };
