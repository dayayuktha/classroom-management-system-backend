const express = require('express');
const router = express.Router();
const {
  createAssignment,
  getAssignments,
  getAssignment,
  updateAssignment,
  deleteAssignment
} = require('../controllers/assignmentController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { validateAssignment } = require('../middleware/validation');

// All routes require authentication
router.use(authMiddleware);

// Teacher-only routes
router.post('/', roleMiddleware('teacher', 'admin'), validateAssignment, createAssignment);
router.put('/:id', roleMiddleware('teacher', 'admin'), updateAssignment);
router.delete('/:id', roleMiddleware('teacher', 'admin'), deleteAssignment);

// Shared routes (access control in controller)
router.get('/', getAssignments);
router.get('/:id', getAssignment);

module.exports = router;