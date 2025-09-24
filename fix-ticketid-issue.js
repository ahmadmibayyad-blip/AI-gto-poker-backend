const mongoose = require('mongoose');
require('dotenv').config();

async function fixTicketIdIssue() {
  try {
    console.log('🔧 Starting ticketId issue fix...');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('supports');

    // Step 1: List all indexes
    console.log('\n📋 Step 1: Checking current indexes...');
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(idx => ({ name: idx.name, key: idx.key })));

    // Step 2: Drop ticketId related indexes
    console.log('\n🗑️ Step 2: Dropping ticketId related indexes...');
    const ticketIdIndexes = indexes.filter(index => 
      index.name.includes('ticketId') || 
      (index.key && index.key.ticketId)
    );
    
    for (const index of ticketIdIndexes) {
      try {
        console.log(`Dropping index: ${index.name}`);
        await collection.dropIndex(index.name);
        console.log(`✅ Dropped: ${index.name}`);
      } catch (error) {
        console.log(`❌ Failed to drop ${index.name}:`, error.message);
      }
    }

    // Step 3: Remove ticketId field from all existing documents
    console.log('\n🧹 Step 3: Cleaning up existing documents...');
    const updateResult = await collection.updateMany(
      { ticketId: { $exists: true } },
      { $unset: { ticketId: "" } }
    );
    console.log(`✅ Updated ${updateResult.modifiedCount} documents`);

    // Step 4: Verify indexes are gone
    console.log('\n✅ Step 4: Verifying indexes...');
    const updatedIndexes = await collection.indexes();
    const remainingTicketIdIndexes = updatedIndexes.filter(index => 
      index.name.includes('ticketId') || 
      (index.key && index.key.ticketId)
    );
    
    if (remainingTicketIdIndexes.length === 0) {
      console.log('✅ All ticketId indexes removed successfully');
    } else {
      console.log('⚠️ Some ticketId indexes still exist:', remainingTicketIdIndexes);
    }

    // Step 5: Test document creation
    console.log('\n🧪 Step 5: Testing document creation...');
    try {
      const testDoc = {
        type: 'general',
        priority: 'medium',
        status: 'open',
        subject: 'Test Subject',
        description: 'Test Description',
        userEmail: 'test@example.com',
        userFullName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await collection.insertOne(testDoc);
      console.log('✅ Test document created successfully:', result.insertedId);
      
      // Clean up
      await collection.deleteOne({ _id: result.insertedId });
      console.log('🧹 Test document cleaned up');
      
    } catch (testError) {
      console.log('❌ Test failed:', testError.message);
    }

    console.log('\n🎉 Fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the fix
fixTicketIdIssue();
