const { evaluateEarlyWarning } = require('../services/earlyWarningService');
const { notifyEarlyWarning } = require('../services/notificationService');

const evaluateWarning = async (req, res) => {
  try {
    const input = req.body;

    if (!input || typeof input !== 'object') {
      return res.status(400).json({ error: 'Invalid input structure. Expected an object.' });
    }

    const warningResult = evaluateEarlyWarning(input);

    if (warningResult.decisionStatus === 'error') {
      return res.status(400).json({ error: warningResult.error || 'Invalid input for warning evaluation.' });
    }

    // Safely trigger downstream notification if applicable, without blocking the response
    // or failing the request if the DB throws an error.
    try {
      notifyEarlyWarning(warningResult).catch(err => {
        console.error('Non-fatal error creating downstream early warning notification:', err);
      });
    } catch (err) {
      console.error('Non-fatal error initiating early warning notification:', err);
    }

    res.status(200).json(warningResult);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error evaluating early warning:', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};

module.exports = {
  evaluateWarning
};
