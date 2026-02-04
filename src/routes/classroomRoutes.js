const express = require('express');
const router = express.Router();
const {
  createClassroom,
  getClassrooms,
  getClassroom,
  updateClassroom,
  deleteClassroom,
  enrollStudent,
  getStudents
} = require('../controllers/classroomController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { validateClassroom } = require('../middleware/validation');

// All routes require authentication
router.use(authMiddleware);

// Teacher-only routes
router.post('/', roleMiddleware('teacher', 'admin'), validateClassroom, createClassroom);
router.put('/:id', roleMiddleware('teacher', 'admin'), updateClassroom);
router.delete('/:id', roleMiddleware('teacher', 'admin'), deleteClassroom);
router.get('/:id/students', roleMiddleware('teacher', 'admin'), getStudents);

// Student routes
router.post('/enroll', roleMiddleware('student'), enrollStudent);

// Shared routes
router.get('/', getClassrooms);
router.get('/:id', getClassroom);

module.exports = router;