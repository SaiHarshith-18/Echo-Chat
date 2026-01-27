import express from "express";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import { createClient } from "redis";
import userRoutes from "./routes/user.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT;

//MongoDB
connectDB();

//Redis
export const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379"
});

redisClient.connect().then(() => {
  console.log("Connected to Redis");
}).catch((err) => {
  console.error("Error connecting to Redis:", err);
});

app.use("api/v1", userRoutes);

app.listen(PORT, () => {
  console.log(`User Service is running on port ${PORT}`);
});

