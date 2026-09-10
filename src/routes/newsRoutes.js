const express = require('express');
const router = express.Router();
const { getAllNews, getNewsById, refreshNews } = require('../controllers/newsController');

router.get('/', getAllNews);
router.post('/refresh', refreshNews);
router.get('/:id', getNewsById);

module.exports = router;
