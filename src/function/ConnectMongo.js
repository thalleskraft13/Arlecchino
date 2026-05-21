const mongoose = require('mongoose');

let isConnected = false;

/**
 * Connect to MongoDB using Mongoose
 */
async function connectMongo() {

    if (!process.env.MONGO_URI)
        throw new Error('MONGO_URI is not defined.');

    if (isConnected) return mongoose.connection;

    try {

        await mongoose.connect(process.env.MONGO_URI, {
            autoIndex: true
        });

        isConnected = true;

        
        return mongoose.connection;

    } catch (error) {

        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
}

module.exports = connectMongo;