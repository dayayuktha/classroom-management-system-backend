const express = require('express');
const router = express.Router();
const {
  submitAssignment,
  getSubmissions,
  getSubmission,
  gradeSubmission,
  getMySubmissions
} = require('../controllers/submissionController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// All routes require authentication
router.use(authMiddleware);

// Student routes
router.post('/', roleMiddleware('student'), submitAssignment);
router.get('/my-submissions', roleMiddleware('student'), getMySubmissions);

// Teacher routes
router.post('/:id/grade', roleMiddleware('teacher', 'admin'), gradeSubmission);

// Shared routes (access control in controller)
router.get('/', getSubmissions);
router.get('/:id', getSubmission);

module.exports = router;