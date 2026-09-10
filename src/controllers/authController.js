const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');

/**
 * Register a new user. Always assigns role "citizen".
 */
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password || typeof name !== 'string' || typeof email !== 'string' || !name.trim() || !email.trim()) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Force role to citizen, completely ignoring any req.body.role
    const user = new User({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: 'citizen'
    });

    await user.save();

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors || {}).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') || 'Validation error.' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'An unexpected error occurred during registration.' });
  }
};

/**
 * Login a user. Returns a JWT.
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Explicitly select passwordHash to compare
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

    // Generic error for invalid credentials
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN || '24h' }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'An unexpected error occurred during login.' });
  }
};

/**
 * Get current user profile securely.
 */
const getMe = async (req, res) => {
  try {
    // req.user is populated by authenticate middleware
    const user = req.user;

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get Me error:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

module.exports = {
  register,
  login,
  getMe
};
