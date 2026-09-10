const app = require('./src/app');
const { PORT, MONGODB_URI } = require('./src/config/env');
const connectDB = require('./src/config/database');

const startServer = async () => {
  try {
    await connectDB(MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Server startup aborted due to database connection failure:');
    console.error(error);
    process.exit(1);
  }
};

startServer();
