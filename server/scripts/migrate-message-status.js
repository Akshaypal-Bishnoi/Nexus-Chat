/**
 * Migration Script: Convert old `seen` boolean to new `status` field
 * 
 * Run this ONCE after deploying the new Message schema:
 *   node scripts/migrate-message-status.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/db.js";

const migrate = async () => {
    await connectDB();

    const db = mongoose.connection.db;
    const collection = db.collection("messages");

    // Convert seen: true → status: "read"
    const readResult = await collection.updateMany(
        { seen: true },
        { $set: { status: "read" }, $unset: { seen: "" } }
    );
    console.log(`✅ Migrated ${readResult.modifiedCount} messages from seen:true → status:"read"`);

    // Convert seen: false → status: "sent"
    const sentResult = await collection.updateMany(
        { seen: false },
        { $set: { status: "sent" }, $unset: { seen: "" } }
    );
    console.log(`✅ Migrated ${sentResult.modifiedCount} messages from seen:false → status:"sent"`);

    // Handle messages that don't have seen field at all (just in case)
    const noStatusResult = await collection.updateMany(
        { status: { $exists: false } },
        { $set: { status: "sent" } }
    );
    console.log(`✅ Set status:"sent" on ${noStatusResult.modifiedCount} messages without status field`);

    console.log("\n🎉 Migration complete!");
    process.exit(0);
};

migrate().catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
});
