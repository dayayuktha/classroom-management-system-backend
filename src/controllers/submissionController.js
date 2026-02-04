const pool = require('../config/database');

const submitAssignment = async (req, res, next) => {
  try {
    const { assignment_id, content, file_name, file_path, file_size } = req.body;

    // Verify assignment exists and is published
    const assignmentCheck = await pool.query(
      `SELECT a.*, c.id as classroom_id
       FROM assignments a
       JOIN classrooms c ON a.classroom_id = c.id
       WHERE a.id = $1 AND a.status = 'published'`,
      [assignment_id]
    );

    if (assignmentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found or not published' });
    }

    const assignment = assignmentCheck.rows[0];

    // Verify student is enrolled
    const enrollCheck = await pool.query(
      'SELECT * FROM enrollments WHERE student_id = $1 AND classroom_id = $2',
      [req.user.id, assignment.classroom_id]
    );

    if (enrollCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
    }

    // Create or update submission
    const result = await pool.query(
      `INSERT INTO submissions (assignment_id, student_id, content, file_name, file_path, file_size, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted')
       ON CONFLICT (assignment_id, student_id) 
       DO UPDATE SET 
         content = EXCLUDED.content,
         file_name = EXCLUDED.file_name,
         file_path = EXCLUDED.file_path,
         file_size = EXCLUDED.file_size,
         status = 'submitted',
         submitted_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [assignment_id, req.user.id, content, file_name, file_path, file_size]
    );

    res.status(201).json({
      message: 'Assignment submitted successfully',
      submission: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const getSubmissions = async (req, res, next) => {
  try {
    const { assignment_id, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!assignment_id) {
      return res.status(400).json({ error: 'assignment_id is required' });
    }

    // For teachers: check ownership
    if (req.user.role === 'teacher') {
      const ownershipCheck = await pool.query(
        `SELECT a.* FROM assignments a
         JOIN classrooms c ON a.classroom_id = c.id
         WHERE a.id = $1 AND c.teacher_id = $2`,
        [assignment_id, req.user.id]
      );

      if (ownershipCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get all submissions for this assignment
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM submissions WHERE assignment_id = $1',
        [assignment_id]
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await pool.query(
        `SELECT s.*, u.full_name as student_name, u.email as student_email
         FROM submissions s
         JOIN users u ON s.student_id = u.id
         WHERE s.assignment_id = $1
         ORDER BY s.submitted_at DESC
         LIMIT $2 OFFSET $3`,
        [assignment_id, limit, offset]
      );

      return res.json({
        submissions: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    }

    // For students: only their own submission
    if (req.user.role === 'student') {
      const result = await pool.query(
        `SELECT s.*, a.title as assignment_title, a.max_score
         FROM submissions s
         JOIN assignments a ON s.assignment_id = a.id
         WHERE s.assignment_id = $1 AND s.student_id = $2`,
        [assignment_id, req.user.id]
      );

      return res.json({ submissions: result.rows });
    }

    res.status(403).json({ error: 'Access denied' });
  } catch (error) {
    next(error);
  }
};

const getSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT s.*, u.full_name as student_name, u.email as student_email,
              a.title as assignment_title, a.max_score, c.teacher_id
       FROM submissions s
       JOIN users u ON s.student_id = u.id
       JOIN assignments a ON s.assignment_id = a.id
       JOIN classrooms c ON a.classroom_id = c.id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const submission = result.rows[0];

    // Check access
    if (req.user.role === 'teacher' && submission.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user.role === 'student' && submission.student_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ submission });
  } catch (error) {
    next(error);
  }
};

const gradeSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { score, feedback } = req.body;

    // Verify teacher owns the classroom
    const checkResult = await pool.query(
      `SELECT s.* FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       JOIN classrooms c ON a.classroom_id = c.id
       WHERE s.id = $1 AND c.teacher_id = $2`,
      [id, req.user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found or access denied' });
    }

    const submission = checkResult.rows[0];

    // Get max_score for validation
    const assignmentResult = await pool.query(
      'SELECT max_score FROM assignments WHERE id = $1',
      [submission.assignment_id]
    );
    const max_score = assignmentResult.rows[0].max_score;

    if (score !== undefined && (score < 0 || score > max_score)) {
      return res.status(400).json({ error: `Score must be between 0 and ${max_score}` });
    }

    const result = await pool.query(
      `UPDATE submissions 
       SET score = $1,
           feedback = $2,
           status = 'graded',
           graded_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [score, feedback, id]
    );

    res.json({
      message: 'Submission graded successfully',
      submission: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const getMySubmissions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT s.*, a.title as assignment_title, a.max_score, a.due_date,
             c.name as classroom_name
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classrooms c ON a.classroom_id = c.id
      WHERE s.student_id = $1
    `;
    const params = [req.user.id];

    if (status) {
      query += ` AND s.status = $${params.length + 1}`;
      params.push(status);
    }

    // Get total count
    const countResult = await pool.query(
      query.replace('s.*, a.title as assignment_title, a.max_score, a.due_date,', 'COUNT(*)').replace('c.name as classroom_name', ''),
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    query += ` ORDER BY s.submitted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      submissions: result.rows,
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

module.exports = {
  submitAssignment,
  getSubmissions,
  getSubmission,
  gradeSubmission,
  getMySubmissions
};