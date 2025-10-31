/**
 * Script to fix Transaction model indexes
 * This will drop the old stripePaymentIntentId unique index that causes issues with crypto payments
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

async function fixIndexes() {
  try {
    console.log('🔧 Starting index fix...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gto-poker-app');
    console.log('✅ Connected to MongoDB');

    // Get current indexes
    const indexes = await Transaction.collection.indexes();
    console.log('\n📋 Current indexes:');
    indexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    // Drop all old problematic indexes
    const indexesToDrop = ['stripePaymentIntentId_1', 'stripeSessionId_1', 'cryptoTransactionHash_1'];
    
    for (const indexName of indexesToDrop) {
      try {
        await Transaction.collection.dropIndex(indexName);
        console.log(`\n✅ Dropped old ${indexName} index`);
      } catch (error) {
        if (error.code === 27) {
          console.log(`\n⚠️  Index ${indexName} does not exist (already removed)`);
        } else {
          console.log(`\n⚠️  Could not drop ${indexName}:`, error.message);
        }
      }
    }

    // Ensure the model indexes are created (including the correct partial indexes)
    console.log('\n🔄 Creating new indexes with proper configuration...');
    await Transaction.syncIndexes();
    console.log('✅ Synchronized model indexes');

    // Show final indexes
    const finalIndexes = await Transaction.collection.indexes();
    console.log('\n📋 Final indexes:');
    finalIndexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
      if (index.partialFilterExpression) {
        console.log(`    Partial filter:`, JSON.stringify(index.partialFilterExpression));
      }
    });

    console.log('\n✅ Index fix completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error fixing indexes:', error);
    process.exit(1);
  }
}

fixIndexes();

