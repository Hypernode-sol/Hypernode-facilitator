/**
 * Test script for Redis Payment Intent Store
 *
 * Run with: node test-redis-store.js
 */

import { RedisPaymentIntentStore } from './x402-redis-store.js';
import { PaymentIntent } from './x402.js';

async function testRedisStore() {
  console.log('🧪 Testing Redis Payment Intent Store\n');

  // Initialize store
  const store = new RedisPaymentIntentStore({
    host: 'localhost',
    port: 6379,
  });

  try {
    // Health check
    console.log('1️⃣ Health Check');
    const isHealthy = await store.isHealthy();
    console.log(`   Redis healthy: ${isHealthy ? '✅' : '❌'}\n`);

    if (!isHealthy) {
      console.error('❌ Redis is not running. Please start Redis first.');
      console.log('   docker run -d -p 6379:6379 redis:7-alpine');
      process.exit(1);
    }

    // Create test payment intent
    console.log('2️⃣ Creating Payment Intent');
    const intent = new PaymentIntent({
      client: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      amount: 100.5,
      jobId: 'test-job-12345',
    });
    const signature = 'test-signature-base58-encoded-string';

    console.log(`   Intent ID: ${intent.intentId}`);
    console.log(`   Client: ${intent.client}`);
    console.log(`   Amount: ${intent.amount} HYPER`);
    console.log(`   Job ID: ${intent.jobId}\n`);

    // Store intent
    console.log('3️⃣ Storing Payment Intent');
    await store.store(intent, signature);
    console.log('   ✅ Stored successfully\n');

    // Retrieve intent
    console.log('4️⃣ Retrieving Payment Intent');
    const retrieved = await store.retrieve(intent.intentId);
    console.log(`   Retrieved: ${retrieved ? '✅' : '❌'}`);
    if (retrieved) {
      console.log(`   Client matches: ${retrieved.intent.client === intent.client ? '✅' : '❌'}`);
      console.log(`   Amount matches: ${retrieved.intent.amount === intent.amount ? '✅' : '❌'}`);
      console.log(`   Used: ${retrieved.used}\n`);
    }

    // Check if used
    console.log('5️⃣ Checking Usage Status');
    let isUsed = await store.isUsed(intent.intentId);
    console.log(`   Is used: ${isUsed ? '❌ Should be false!' : '✅ Correct'}\n`);

    // Mark as used
    console.log('6️⃣ Marking as Used');
    const marked = await store.markUsed(intent.intentId);
    console.log(`   Marked: ${marked ? '✅' : '❌'}\n`);

    // Check again
    console.log('7️⃣ Checking Usage Status Again');
    isUsed = await store.isUsed(intent.intentId);
    console.log(`   Is used: ${isUsed ? '✅ Correct' : '❌ Should be true!'}\n`);

    // Try to retrieve after marking as used
    console.log('8️⃣ Retrieving After Use');
    const retrievedAgain = await store.retrieve(intent.intentId);
    if (retrievedAgain) {
      console.log(`   Used status: ${retrievedAgain.used ? '✅ Marked as used' : '❌'}\n`);
    }

    // Get stats
    console.log('9️⃣ Statistics');
    const stats = await store.stats();
    console.log(`   Total intents: ${stats.total}`);
    console.log(`   Active: ${stats.active}`);
    console.log(`   Used: ${stats.used}\n`);

    // Test expiration
    console.log('🔟 Testing Expiration');
    const expiredIntent = new PaymentIntent({
      client: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      amount: 50,
      jobId: 'test-job-expired',
      expiresAt: Date.now() - 1000, // Expired 1 second ago
    });

    await store.store(expiredIntent, 'expired-sig');
    console.log(`   Stored expired intent: ${expiredIntent.intentId}`);

    const retrievedExpired = await store.retrieve(expiredIntent.intentId);
    console.log(`   Retrieved expired: ${retrievedExpired === null ? '✅ Correctly rejected' : '❌ Should be null'}\n`);

    // Cleanup
    console.log('1️⃣1️⃣ Manual Cleanup');
    const deleted = await store.cleanup();
    console.log(`   Deleted ${deleted} expired intent(s)\n`);

    // Final stats
    console.log('1️⃣2️⃣ Final Statistics');
    const finalStats = await store.stats();
    console.log(`   Total intents: ${finalStats.total}`);
    console.log(`   Active: ${finalStats.active}`);
    console.log(`   Used: ${finalStats.used}\n`);

    console.log('✅ All tests passed!\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Close connection
    await store.close();
    console.log('🔌 Redis connection closed');
  }
}

// Run tests
testRedisStore().catch(console.error);
