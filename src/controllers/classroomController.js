const pool = require('../config/database');

// Generate random invite code
const generateInviteCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const createClassroom = async (req, res, next) => {
  try {
    const { name, description, subject } = req.body;
    const teacher_id = req.user.id;

    const invite_code = generateInviteCode();

    const result = await pool.query(
      `INSERT INTO classrooms (name, description, subject, invite_code, teacher_id) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [name, description, subject, invite_code, teacher_id]
    );

    res.status(201).json({
      message: 'Classroom created successfully',
      classroom: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const getClassrooms = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, subject } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT c.*, u.full_name as teacher_name,
        (SELECT COUNT(*) FROM enrollments WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN users u ON c.teacher_id = u.id
    `;
    const params = [];

    // Role-based filtering
    if (req.user.role === 'teacher') {
      query += ` WHERE c.teacher_id = $${params.length + 1}`;
      params.push(req.user.id);
    } else if (req.user.role === 'student') {
      query += ` WHERE c.id IN (
        SELECT classroom_id FROM enrollments WHERE student_id = $${params.length + 1}
      )`;
      params.push(req.user.id);
    }

    // Subject filter
    if (subject) {
      query += params.length > 0 ? ' AND' : ' WHERE';
      query += ` c.subject = $${params.length + 1}`;
      params.push(subject);
    }

    // Count total
    const countResult = await pool.query(
      query.replace('c.*, u.full_name as teacher_name,', 'COUNT(*)'),
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    query += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      classrooms: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getClassroom = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, u.full_name as teacher_name,
        (SELECT COUNT(*) FROM enrollments WHERE classroom_id = c.id) as student_count
       FROM classrooms c
       JOIN users u ON c.teacher_id = u.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    const classroom = result.rows[0];

    // Check access
    if (req.user.role === 'teacher' && classroom.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user.role === 'student') {
      const enrollCheck = await pool.query(
        'SELECT * FROM enrollments WHERE student_id = $1 AND classroom_id = $2',
        [req.user.id, id]
      );
      if (enrollCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Not enrolled in this classroom' });
      }
    }

    res.json({ classroom });
  } catch (error) {
    next(error);
  }
};

const updateClassroom = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, subject } = req.body;

    // Check ownership
    const checkResult = await pool.query(
      'SELECT * FROM classrooms WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom not found or access denied' });
    }

    const result = await pool.query(
      `UPDATE classrooms 
       SET name = COALESCE($1, name), 
           description = COALESCE($2, description), 
           subject = COALESCE($3, subject),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 
       RETURNING *`,
      [name, description, subject, id]
    );

    res.json({
      message: 'Classroom updated successfully',
      classroom: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const deleteClassroom = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM classrooms WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom not found or access denied' });
    }

    res.json({ message: 'Classroom deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const enrollStudent = async (req, res, next) => {
  try {
    const { invite_code } = req.body;

    // Find classroom
    const classroomResult = await pool.query(
      'SELECT * FROM classrooms WHERE invite_code = $1',
      [invite_code]
    );

    if (classroomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const classroom = classroomResult.rows[0];

    // Enroll student
    await pool.query(
      'INSERT INTO enrollments (student_id, classroom_id) VALUES ($1, $2)',
      [req.user.id, classroom.id]
    );

    res.status(201).json({
      message: 'Enrolled successfully',
      classroom
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Already enrolled in this classroom' });
    }
    next(error);
  }
};

const getStudents = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check classroom ownership
    const classroomCheck = await pool.query(
      'SELECT * FROM classrooms WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id]
    );

    if (classroomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom not found or access denied' });
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, e.enrolled_at
       FROM users u
       JOIN enrollments e ON u.id = e.student_id
       WHERE e.classroom_id = $1
       ORDER BY e.enrolled_at DESC`,
      [id]
    );

    res.json({ students: result.rows });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createClassroom,
  getClassrooms,
  getClassroom,
  updateClassroom,
  deleteClassroom,
  enrollStudent,
  getStudents
};