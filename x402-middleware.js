/**
 * x402 Middleware for Express - Redis-backed Version
 *
 * Async middleware that uses Redis for persistent payment intent storage
 */

import { X402Verifier, PaymentIntent } from './x402.js';
import { getPaymentIntentStore } from './x402-redis-store.js';

/**
 * Initialize x402 middleware with Redis storage
 *
 * @param {object} config - Redis configuration
 * @returns {Function} Express middleware function
 */
export function createX402Middleware(config = {}) {
  const intentStore = getPaymentIntentStore(config);

  /**
   * x402 Middleware - Async version
   */
  return async function x402Middleware(req, res, next) {
    const authHeader = req.headers['x-payment-intent'];

    if (!authHeader) {
      return res.status(402).json({
        error: 'Payment Required',
        message: 'x402: Missing payment intent header',
        required: {
          header: 'x-payment-intent',
          format: '{ "intent": {...}, "signature": "..." }',
        },
      });
    }

    try {
      const { intent, signature } = JSON.parse(authHeader);

      // Create PaymentIntent object
      const paymentIntent = new PaymentIntent(intent);

      // Verify signature
      const verification = X402Verifier.verify(
        paymentIntent,
        signature,
        intent.client
      );

      if (!verification.valid) {
        return res.status(402).json({
          error: 'Payment Required',
          message: `x402: ${verification.error}`,
        });
      }

      // Check if already used (async)
      const alreadyUsed = await intentStore.isUsed(paymentIntent.intentId);

      if (alreadyUsed) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Payment intent already used or expired',
        });
      }

      // Store intent (async)
      await intentStore.store(paymentIntent, signature);

      // Attach to request for downstream handlers
      req.paymentIntent = paymentIntent;
      req.paymentSignature = signature;

      next();
    } catch (error) {
      console.error('[x402] Middleware error:', error);

      return res.status(400).json({
        error: 'Bad Request',
        message: `x402: ${error.message}`,
      });
    }
  };
}

/**
 * Middleware to mark payment intent as used after successful processing
 *
 * Call this at the end of your request handler to mark the intent as consumed
 */
export function createX402UsageMarker(config = {}) {
  const intentStore = getPaymentIntentStore(config);

  return async function x402UsageMarker(req, res, next) {
    if (req.paymentIntent) {
      try {
        await intentStore.markUsed(req.paymentIntent.intentId);
      } catch (error) {
        console.error('[x402] Error marking intent as used:', error);
        // Don't fail the request if we can't mark as used
      }
    }
    next();
  };
}

/**
 * Health check endpoint for x402 system
 */
export function createX402HealthCheck(config = {}) {
  const intentStore = getPaymentIntentStore(config);

  return async function x402HealthCheck(req, res) {
    try {
      const isHealthy = await intentStore.isHealthy();
      const stats = await intentStore.stats();

      if (!isHealthy) {
        return res.status(503).json({
          status: 'unhealthy',
          message: 'Redis connection failed',
        });
      }

      res.json({
        status: 'healthy',
        stats,
        redis: 'connected',
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
      });
    }
  };
}

export default createX402Middleware;
