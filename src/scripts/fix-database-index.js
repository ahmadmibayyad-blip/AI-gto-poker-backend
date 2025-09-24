const mongoose = require('mongoose');
require('dotenv').config();

async function fixDatabaseIndex() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get the supports collection
    const db = mongoose.connection.db;
    const collection = db.collection('supports');

    // List all indexes
    const indexes = await collection.indexes();
    console.log('📋 Current indexes:', indexes.map(idx => ({ name: idx.name, key: idx.key })));

    // Check if ticketId_1 index exists
    const ticketIdIndex = indexes.find(index => index.name === 'ticketId_1');
    
    if (ticketIdIndex) {
      console.log('🔍 Found ticketId_1 index, dropping it...');
      try {
        await collection.dropIndex('ticketId_1');
        console.log('✅ Successfully dropped ticketId_1 index');
      } catch (dropError) {
        console.log('⚠️ Error dropping index:', dropError.message);
        // Try alternative approach - drop by key pattern
        try {
          await collection.dropIndex({ ticketId: 1 });
          console.log('✅ Successfully dropped ticketId index by key pattern');
        } catch (altError) {
          console.log('❌ Failed to drop index:', altError.message);
        }
      }
    } else {
      console.log('ℹ️ No ticketId_1 index found');
    }

    // Also check for any other ticketId related indexes
    const ticketIdRelatedIndexes = indexes.filter(index => 
      index.name.includes('ticketId') || 
      (index.key && index.key.ticketId)
    );
    
    if (ticketIdRelatedIndexes.length > 0) {
      console.log('🔍 Found other ticketId related indexes:', ticketIdRelatedIndexes);
      for (const index of ticketIdRelatedIndexes) {
        try {
          await collection.dropIndex(index.name);
          console.log(`✅ Dropped index: ${index.name}`);
        } catch (error) {
          console.log(`❌ Failed to drop ${index.name}:`, error.message);
        }
      }
    }

    // List indexes again to confirm
    const updatedIndexes = await collection.indexes();
    console.log('📋 Updated indexes:', updatedIndexes.map(idx => ({ name: idx.name, key: idx.key })));

    // Test creating a document without ticketId
    console.log('🧪 Testing document creation...');
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
      
      // Remove any ticketId field if it exists
      delete testDoc.ticketId;
      
      const result = await collection.insertOne(testDoc);
      console.log('✅ Test document created successfully:', result.insertedId);
      
      // Clean up test document
      await collection.deleteOne({ _id: result.insertedId });
      console.log('🧹 Test document cleaned up');
      
    } catch (testError) {
      console.log('❌ Test document creation failed:', testError.message);
    }

    console.log('🎉 Database fix completed');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the fix
fixDatabaseIndex();
