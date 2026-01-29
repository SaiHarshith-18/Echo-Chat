import express from "express";

const router = express.Router();

export default router;import { User, type IUser, } from "../models/user.js";

// Create a new user
router.post("/users", async (req, res) => {
  try {
    const { username, email } = req.body;
    const newUser: IUser = new User({ username, email });
    await newUser.save();
    res.status(201).json(newUser);
  }     catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});