const pool = require('../config/database');

const createAssignment = async (req, res, next) => {
  try {
    const { classroom_id, title, description, max_score, due_date, status } = req.body;

    // Verify teacher owns the classroom
    const classroomCheck = await pool.query(
      'SELECT * FROM classrooms WHERE id = $1 AND teacher_id = $2',
      [classroom_id, req.user.id]
    );

    if (classroomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom not found or access denied' });
    }

    const result = await pool.query(
      `INSERT INTO assignments (classroom_id, title, description, max_score, due_date, status) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [classroom_id, title, description, max_score || 100, due_date, status || 'draft']
    );

    res.status(201).json({
      message: 'Assignment created successfully',
      assignment: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const getAssignments = async (req, res, next) => {
  try {
    const { classroom_id, status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!classroom_id) {
      return res.status(400).json({ error: 'classroom_id is required' });
    }

    // Check access to classroom
    let accessQuery;
    if (req.user.role === 'teacher') {
      accessQuery = await pool.query(
        'SELECT * FROM classrooms WHERE id = $1 AND teacher_id = $2',
        [classroom_id, req.user.id]
      );
    } else if (req.user.role === 'student') {
      accessQuery = await pool.query(
        'SELECT * FROM enrollments WHERE classroom_id = $1 AND student_id = $2',
        [classroom_id, req.user.id]
      );
    }

    if (accessQuery.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this classroom' });
    }

    let query = `SELECT * FROM assignments WHERE classroom_id = $1`;
    const params = [classroom_id];

    // Students can only see published assignments
    if (req.user.role === 'student') {
      query += ` AND status = 'published'`;
    }

    // Filter by status
    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    // Get total count
    const countResult = await pool.query(
      query.replace('*', 'COUNT(*)'),
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      assignments: result.rows,
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

const getAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT a.*, c.name as classroom_name, c.teacher_id
       FROM assignments a
       JOIN classrooms c ON a.classroom_id = c.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignment = result.rows[0];

    // Check access
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user.role === 'student') {
      if (assignment.status !== 'published') {
        return res.status(403).json({ error: 'Assignment not yet published' });
      }

      const enrollCheck = await pool.query(
        'SELECT * FROM enrollments WHERE student_id = $1 AND classroom_id = $2',
        [req.user.id, assignment.classroom_id]
      );

      if (enrollCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Not enrolled in this classroom' });
      }
    }

    res.json({ assignment });
  } catch (error) {
    next(error);
  }
};

const updateAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, max_score, due_date, status } = req.body;

    // Check ownership through classroom
    const checkResult = await pool.query(
      `SELECT a.* FROM assignments a
       JOIN classrooms c ON a.classroom_id = c.id
       WHERE a.id = $1 AND c.teacher_id = $2`,
      [id, req.user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found or access denied' });
    }

    const result = await pool.query(
      `UPDATE assignments 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           max_score = COALESCE($3, max_score),
           due_date = COALESCE($4, due_date),
           status = COALESCE($5, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 
       RETURNING *`,
      [title, description, max_score, due_date, status, id]
    );

    res.json({
      message: 'Assignment updated successfully',
      assignment: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const deleteAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM assignments 
       WHERE id = $1 
       AND classroom_id IN (
         SELECT id FROM classrooms WHERE teacher_id = $2
       )
       RETURNING id`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found or access denied' });
    }

    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAssignment,
  getAssignments,
  getAssignment,
  updateAssignment,
  deleteAssignment
};